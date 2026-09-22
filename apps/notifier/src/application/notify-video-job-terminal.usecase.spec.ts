import { JOB_EVENT_TYPES } from '@4frames/shared/jobs';
import { createLogger } from '@4frames/shared/logger';

import { type VideoJobNotificationService } from '@/infra/notifications/email/services/video-job-notification.service';
import { type PrismaVideoJobNotifierRepository } from '@/repo/video-job-notifier.repository';

import { NotifyVideoJobTerminalUseCase } from './notify-video-job-terminal.usecase';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

describe('NotifyVideoJobTerminalUseCase', () => {
  const repository: jest.Mocked<Pick<PrismaVideoJobNotifierRepository, 'findForNotify' | 'markNotified'>> = {
    findForNotify: jest.fn(),
    markNotified: jest.fn()
  };
  const notificationService: jest.Mocked<Pick<VideoJobNotificationService, 'notify'>> = {
    notify: jest.fn()
  };
  const logger = createLogger({ level: 'silent' });

  const useCase = new NotifyVideoJobTerminalUseCase({
    repository: repository as PrismaVideoJobNotifierRepository,
    notificationService: notificationService as VideoJobNotificationService,
    webAppBaseUrl: 'http://localhost:5173',
    logger
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repository.markNotified.mockResolvedValue(true);
  });

  it('should ignore progress events', async () => {
    await useCase.fromRedisEvent({
      type: JOB_EVENT_TYPES.progress,
      jobId: JOB_ID,
      userId: 1,
      percent: 50
    });

    expect(repository.findForNotify).not.toHaveBeenCalled();
  });

  it('should send notification and mark notified_at for job.done', async () => {
    repository.findForNotify.mockResolvedValue({
      jobId: JOB_ID,
      userId: 1,
      userEmail: 'user@user.com',
      fileName: 'a.mp4',
      status: 'DONE',
      failureReason: null,
      frameCount: 3,
      notifiedAt: null
    });

    await useCase.fromRedisEvent({
      type: JOB_EVENT_TYPES.done,
      jobId: JOB_ID,
      userId: 1,
      zipKey: 'zips/1/x.zip',
      frameCount: 3
    });

    expect(notificationService.notify).toHaveBeenCalledTimes(1);
    expect(repository.markNotified).toHaveBeenCalledWith(JOB_ID);
  });

  it('should skip when already notified', async () => {
    repository.findForNotify.mockResolvedValue({
      jobId: JOB_ID,
      userId: 1,
      userEmail: 'user@user.com',
      fileName: 'a.mp4',
      status: 'DONE',
      failureReason: null,
      frameCount: 3,
      notifiedAt: new Date()
    });

    await useCase.fromRedisEvent({
      type: JOB_EVENT_TYPES.done,
      jobId: JOB_ID,
      userId: 1,
      zipKey: 'zips/1/x.zip',
      frameCount: 3
    });

    expect(notificationService.notify).not.toHaveBeenCalled();
  });
});
