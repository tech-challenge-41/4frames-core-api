import { type Logger } from '@4frames/shared/logger';
import { type MonitoringMetrics } from '@4frames/shared/monitoring';

export const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';
export const USER_ID = 7;
export const SOURCE_KEY = `videos/${USER_ID}/${JOB_ID}/source.mp4`;

export function createFakeLogger(): jest.Mocked<Logger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);

  return logger;
}

export function createFakeMonitoring(enabled = true): jest.Mocked<MonitoringMetrics> {
  return {
    enabled,
    incrementVideoJobsCreated: jest.fn(),
    incrementVideoJobsDone: jest.fn(),
    incrementVideoJobsFailed: jest.fn(),
    captureJobProcessingDuration: jest.fn(),
    recordQueueDepth: jest.fn(),
    recordStuckProcessingJobs: jest.fn()
  };
}

/** Corpo de mensagem igual ao que a notificação S3 → SQS publica. */
export function s3EventBody(key: string, { bucket = '4frames-videos', eventName = 'ObjectCreated:Put' } = {}): string {
  return JSON.stringify({
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        eventName,
        s3: { bucket: { name: bucket }, object: { key: encodeURIComponent(key).replace(/%2F/g, '/'), size: 1024 } }
      }
    ]
  });
}
