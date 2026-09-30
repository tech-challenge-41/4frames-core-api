import '@4frames/shared/env/load';
// Antes de qualquer outro módulo: a instrumentação do OpenTelemetry só alcança o que for carregado depois.
import '@4frames/shared/monitoring/load';

import fs from 'node:fs/promises';

import { createS3Client, createSqsClient } from '@4frames/shared/aws';
import { HealthServer } from '@4frames/shared/health';
import { createLogger, type Logger } from '@4frames/shared/logger';
import { createMonitoringMetrics, shutdownOtel } from '@4frames/shared/monitoring';
import { prisma } from '@4frames/shared/prisma';
import { registerGracefulShutdown } from '@4frames/shared/process';
import { createRedisClient } from '@4frames/shared/redis';

import { parseWorkerEnv } from './config/worker-env';
import { createDlqHandler } from './consumer/dlq-handler';
import { type MonitoredQueue, QueueDepthMonitor } from './consumer/queue-depth-monitor';
import { SqsConsumer } from './consumer/sqs-consumer';
import { SqsUploadRequeuer } from './consumer/upload-requeuer';
import { createVideoUploadHandler } from './consumer/video-upload-handler';
import { FfmpegFrameExtractor } from './ffmpeg/extract-frames';
import { FfprobeVideoProbe } from './ffmpeg/ffprobe';
import { runProcess } from './ffmpeg/run-process';
import { toError } from './processing/errors';
import { ProcessVideoJobUseCase } from './processing/process-video-job.usecase';
import { RedisJobEventPublisher } from './progress/redis-progress-publisher';
import { PrismaVideoJobRepository } from './repo/video-job.repository';
import { S3ObjectStore } from './storage/s3-object-store';
import { ArchiverFrameZipper } from './zip/zip-frames';

const SERVICE_NAME = 'worker';
// A DLQ só recebe mensagens que esgotaram as tentativas; o handler é rápido.
const DLQ_VISIBILITY_TIMEOUT_SECONDS = 60;

/** Falha cedo se a imagem não tiver ffmpeg/ffprobe no PATH, em vez de falhar em cada job. */
async function assertBinariesAvailable(logger: Logger): Promise<void> {
  for (const binary of ['ffmpeg', 'ffprobe']) {
    const result = await runProcess(binary, ['-version'], { timeoutMs: 10_000 }).catch((error: unknown) => {
      throw new Error(`${binary} not found in PATH: ${toError(error).message}`);
    });

    if (result.exitCode !== 0) {
      throw new Error(`${binary} -version exited with ${result.exitCode}`);
    }

    logger.debug('Binary available', { binary, version: result.stdout.split('\n')[0] });
  }
}

async function bootstrap(): Promise<void> {
  const env = parseWorkerEnv();
  const logger = createLogger({ base: { service: SERVICE_NAME } });

  await assertBinariesAvailable(logger);
  await fs.mkdir(env.WORKER_TMP_DIR, { recursive: true });

  const aws = { region: env.AWS_REGION, endpoint: env.AWS_ENDPOINT_URL };
  const sqs = createSqsClient(aws);
  const s3 = createS3Client(aws);
  // maxRetriesPerRequest baixo: com o Redis fora do ar, a publicação falha rápido em vez de segurar o job.
  const redis = createRedisClient(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  redis.on('error', error => logger.warn('Redis connection error', { error: error.message }));

  // Uma instância por processo: cada uma registra os próprios gauges.
  const monitoring = createMonitoringMetrics();
  const repository = new PrismaVideoJobRepository(prisma.video_jobs);
  const publisher = new RedisJobEventPublisher({ redis, logger });

  const processVideoJob = new ProcessVideoJobUseCase({
    repository,
    storage: new S3ObjectStore({ s3, bucket: env.S3_BUCKET_NAME }),
    probe: new FfprobeVideoProbe({ maxDurationSeconds: env.MAX_VIDEO_DURATION_SECONDS }),
    extractor: new FfmpegFrameExtractor({
      fps: env.FRAME_FPS,
      format: env.FRAME_FORMAT,
      timeoutMs: env.FFMPEG_TIMEOUT_SECONDS * 1000
    }),
    zipper: new ArchiverFrameZipper(),
    publisher,
    logger,
    tmpDir: env.WORKER_TMP_DIR,
    monitoring
  });

  const uploadHandler = createVideoUploadHandler({ processVideoJob, bucket: env.S3_BUCKET_NAME, logger });
  const consumers = [
    new SqsConsumer({
      name: 'uploads',
      sqs,
      queueUrl: env.SQS_QUEUE_URL,
      handler: uploadHandler,
      logger,
      visibilityTimeoutSeconds: env.VISIBILITY_TIMEOUT_SECONDS,
      maxParallelJobs: env.WORKER_MAX_PARALLEL_JOBS
    })
  ];

  if (env.SQS_DLQ_URL) {
    consumers.push(
      new SqsConsumer({
        name: 'dlq',
        sqs,
        queueUrl: env.SQS_DLQ_URL,
        handler: createDlqHandler({
          repository,
          publisher,
          requeuer: new SqsUploadRequeuer({ sqs, queueUrl: env.SQS_QUEUE_URL }),
          logger,
          monitoring
        }),
        logger,
        visibilityTimeoutSeconds: DLQ_VISIBILITY_TIMEOUT_SECONDS
      })
    );
  } else {
    logger.warn('SQS_DLQ_URL is not set: jobs whose messages reach the DLQ will not be marked FAILED');
  }

  const monitoredQueues: MonitoredQueue[] = [{ name: 'uploads', url: env.SQS_QUEUE_URL }];

  if (env.SQS_DLQ_URL) {
    monitoredQueues.push({ name: 'dlq', url: env.SQS_DLQ_URL });
  }

  const queueDepthMonitor = new QueueDepthMonitor({ sqs, queues: monitoredQueues, monitoring, logger });

  const healthServer = new HealthServer({
    port: env.WORKER_HEALTH_PORT,
    isAlive: () => consumers.every(consumer => consumer.isAlive()),
    logger
  });

  // SIGTERM (docker compose stop, scale-down do KEDA): para de receber, termina o job atual e sai.
  registerGracefulShutdown({
    logger,
    timeoutMs: env.WORKER_SHUTDOWN_TIMEOUT_SECONDS * 1000,
    onShutdown: async () => {
      queueDepthMonitor.stop();
      await Promise.all(consumers.map(consumer => consumer.stop()));
      await healthServer.stop();
      await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
      sqs.destroy();
      s3.destroy();
      await shutdownOtel();
    }
  });

  await healthServer.start();
  queueDepthMonitor.start();

  Promise.all(consumers.map(consumer => consumer.start())).catch((error: unknown) => {
    logger.error('Worker stopped unexpectedly', toError(error));
    process.exit(1);
  });

  logger.info('Worker started', {
    nodeEnv: env.NODE_ENV,
    maxParallelJobs: env.WORKER_MAX_PARALLEL_JOBS,
    frameFps: env.FRAME_FPS,
    frameFormat: env.FRAME_FORMAT,
    maxVideoDurationSeconds: env.MAX_VIDEO_DURATION_SECONDS,
    visibilityTimeoutSeconds: env.VISIBILITY_TIMEOUT_SECONDS,
    tmpDir: env.WORKER_TMP_DIR
  });
}

bootstrap().catch((error: unknown) => {
  console.error(`[${SERVICE_NAME}] Failed to start`, error);
  process.exit(1);
});
