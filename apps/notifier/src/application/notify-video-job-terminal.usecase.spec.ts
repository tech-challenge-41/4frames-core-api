import { JOB_EVENT_TYPES } from '@4frames/shared/jobs';
import { createLogger } from '@4frames/shared/logger';

import { type VideoJobNotificationService } from '@/infra/notifications/email/services/video-job-notification.service';
import { type NotifyJobContext, type PrismaVideoJobNotifierRepository } from '@/repo/video-job-notifier.repository';

import { NotifyVideoJobTerminalUseCase } from './notify-video-job-terminal.usecase';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

const doneEvent = {
  type: JOB_EVENT_TYPES.done,
  jobId: JOB_ID,
  userId: 1,
  zipKey: 'zips/1/x.zip',
  frameCount: 3
} as const;

function buildContext(overrides: Partial<NotifyJobContext> = {}): NotifyJobContext {
  return {
    jobId: JOB_ID,
    userId: 1,
    userEmail: 'user@user.com',
    fileName: 'a.mp4',
    status: 'DONE',
    failureReason: null,
    frameCount: 3,
    notifiedAt: null,
    ...overrides
  };
}

describe('NotifyVideoJobTerminalUseCase', () => {
  const repository: jest.Mocked<
    Pick<PrismaVideoJobNotifierRepository, 'findForNotify' | 'claimForNotify' | 'releaseClaim'>
  > = {
    findForNotify: jest.fn(),
    claimForNotify: jest.fn(),
    releaseClaim: jest.fn()
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
    // clearMocks (jest.config) zera as chamadas, não as implementações: sem religar os mocks aqui,
    // um mockRejectedValue de um teste vaza para os seguintes.
    jest.clearAllMocks();
    repository.claimForNotify.mockResolvedValue(true);
    repository.releaseClaim.mockResolvedValue(undefined);
    notificationService.notify.mockResolvedValue(undefined);
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

  it('should claim the job before sending, not after', async () => {
    repository.findForNotify.mockResolvedValue(buildContext());

    await useCase.fromRedisEvent(doneEvent);

    expect(repository.claimForNotify).toHaveBeenCalledWith(JOB_ID);
    expect(notificationService.notify).toHaveBeenCalledTimes(1);
    // A janela de e-mail duplicado existia porque o envio vinha primeiro.
    expect(repository.claimForNotify.mock.invocationCallOrder[0]).toBeLessThan(
      notificationService.notify.mock.invocationCallOrder[0]
    );
  });

  it('should skip when already notified', async () => {
    repository.findForNotify.mockResolvedValue(buildContext({ notifiedAt: new Date() }));

    await useCase.fromRedisEvent(doneEvent);

    expect(repository.claimForNotify).not.toHaveBeenCalled();
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it.each([
    ['job not found or user inactive', null, doneEvent],
    ['userId does not match the event', buildContext({ userId: 2 }), doneEvent],
    ['status has not reached the terminal state of the event yet', buildContext({ status: 'PROCESSING' }), doneEvent]
  ])('should not claim when %s', async (_case, context, event) => {
    repository.findForNotify.mockResolvedValue(context);

    await useCase.fromRedisEvent(event);

    expect(repository.claimForNotify).not.toHaveBeenCalled();
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('should skip the recovery sweep for a job already notified', async () => {
    repository.findForNotify.mockResolvedValue(buildContext({ notifiedAt: new Date() }));

    await useCase.fromRecovery(JOB_ID);

    expect(repository.claimForNotify).not.toHaveBeenCalled();
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('should not send a second e-mail when another notifier won the claim', async () => {
    repository.findForNotify.mockResolvedValue(buildContext());
    repository.claimForNotify.mockResolvedValue(false);

    await useCase.fromRedisEvent(doneEvent);

    expect(notificationService.notify).not.toHaveBeenCalled();
    expect(repository.releaseClaim).not.toHaveBeenCalled();
  });

  it('should release the claim and rethrow when sending fails', async () => {
    repository.findForNotify.mockResolvedValue(buildContext());
    notificationService.notify.mockRejectedValue(new Error('SMTP unavailable'));

    await expect(useCase.fromRedisEvent(doneEvent)).rejects.toThrow('SMTP unavailable');

    expect(repository.releaseClaim).toHaveBeenCalledWith(JOB_ID);
  });

  it('should keep the sending error as the cause when releasing the claim also fails', async () => {
    repository.findForNotify.mockResolvedValue(buildContext());
    notificationService.notify.mockRejectedValue(new Error('SMTP unavailable'));
    repository.releaseClaim.mockRejectedValue(new Error('database unreachable'));

    await expect(useCase.fromRedisEvent(doneEvent)).rejects.toThrow('SMTP unavailable');
  });

  it('should not duplicate from the recovery sweep when the subscriber already claimed the job', async () => {
    repository.findForNotify.mockResolvedValue(buildContext());
    repository.claimForNotify.mockResolvedValue(false);

    await useCase.fromRecovery(JOB_ID);

    expect(repository.claimForNotify).toHaveBeenCalledWith(JOB_ID);
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('should send from the recovery sweep for a failed job nobody notified', async () => {
    repository.findForNotify.mockResolvedValue(
      buildContext({ status: 'FAILED', failureReason: 'Vídeo inválido', frameCount: null })
    );

    await useCase.fromRecovery(JOB_ID);

    expect(notificationService.notify).toHaveBeenCalledTimes(1);
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@user.com',
        event: expect.objectContaining({ type: JOB_EVENT_TYPES.failed, reason: 'Vídeo inválido' })
      })
    );
  });
});
