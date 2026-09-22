import { JOB_EVENT_TYPES, type JobDoneEvent, type JobFailedEvent, type JobEvent } from '@4frames/shared/jobs';
import { type Logger } from '@4frames/shared/logger';

import { type VideoJobNotificationService } from '@/infra/notifications/email/services/video-job-notification.service';
import { type PrismaVideoJobNotifierRepository } from '@/repo/video-job-notifier.repository';

function recipientNameFromEmail(email: string): string {
  const local = email.split('@')[0]?.trim();
  return local && local.length > 0 ? local : email;
}

function isTerminalNotifyEvent(event: JobEvent): event is JobDoneEvent | JobFailedEvent {
  return event.type === JOB_EVENT_TYPES.done || event.type === JOB_EVENT_TYPES.failed;
}

function statusMatchesEvent(status: string, event: JobDoneEvent | JobFailedEvent): boolean {
  if (event.type === JOB_EVENT_TYPES.done) {
    return status === 'DONE';
  }

  return status === 'FAILED';
}

export interface NotifyVideoJobTerminalOptions {
  repository: PrismaVideoJobNotifierRepository;
  notificationService: VideoJobNotificationService;
  webAppBaseUrl: string;
  logger: Logger;
}

export class NotifyVideoJobTerminalUseCase {
  private readonly repository: PrismaVideoJobNotifierRepository;
  private readonly notificationService: VideoJobNotificationService;
  private readonly webAppBaseUrl: string;
  private readonly logger: Logger;

  constructor({ repository, notificationService, webAppBaseUrl, logger }: NotifyVideoJobTerminalOptions) {
    this.repository = repository;
    this.notificationService = notificationService;
    this.webAppBaseUrl = webAppBaseUrl;
    this.logger = logger.child({ component: NotifyVideoJobTerminalUseCase.name });
  }

  public async fromRedisEvent(event: JobEvent): Promise<void> {
    if (!isTerminalNotifyEvent(event)) {
      return;
    }

    await this.notifyJob(event.jobId, event);
  }

  public async fromRecovery(jobId: string): Promise<void> {
    const context = await this.repository.findForNotify(jobId);

    if (!context || context.notifiedAt) {
      return;
    }

    if (context.status === 'DONE') {
      await this.notifyJob(jobId, {
        type: JOB_EVENT_TYPES.done,
        jobId: context.jobId,
        userId: context.userId,
        zipKey: 'recovery',
        frameCount: context.frameCount ?? 0
      });
      return;
    }

    if (context.status === 'FAILED') {
      await this.notifyJob(jobId, {
        type: JOB_EVENT_TYPES.failed,
        jobId: context.jobId,
        userId: context.userId,
        reason: context.failureReason ?? 'Falha no processamento.'
      });
    }
  }

  private async notifyJob(jobId: string, event: JobDoneEvent | JobFailedEvent): Promise<void> {
    const context = await this.repository.findForNotify(jobId);

    if (!context) {
      this.logger.warn('Job not found or user inactive, skipping notification', { jobId });
      return;
    }

    if (context.notifiedAt) {
      return;
    }

    if (context.userId !== event.userId) {
      this.logger.warn('Job event userId mismatch, skipping notification', {
        jobId,
        eventUserId: event.userId,
        jobUserId: context.userId
      });
      return;
    }

    if (!statusMatchesEvent(context.status, event)) {
      this.logger.debug('Job status does not match terminal event yet, skipping', {
        jobId,
        status: context.status,
        eventType: event.type
      });
      return;
    }

    await this.notificationService.notify({
      to: context.userEmail,
      recipientName: recipientNameFromEmail(context.userEmail),
      jobId: context.jobId,
      fileName: context.fileName,
      webAppBaseUrl: this.webAppBaseUrl,
      event
    });

    const marked = await this.repository.markNotified(jobId);

    if (!marked) {
      this.logger.warn('Notification sent but notified_at was already set', { jobId });
    } else {
      this.logger.info('Job terminal notification sent', { jobId, eventType: event.type, to: context.userEmail });
    }
  }
}
