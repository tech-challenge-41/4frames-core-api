import { JOB_EVENT_TYPES } from '@4frames/shared/jobs';

import { buildVideoJobTerminalHtml } from '@/infra/notifications/email/templates/video-job/video-job-template';

import { VideoJobNotificationService } from './video-job-notification.service';

jest.mock('@/infra/notifications/email/templates/video-job/video-job-template');

describe('VideoJobNotificationService', () => {
  const mockEmailSender = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new VideoJobNotificationService(mockEmailSender);

  beforeEach(() => {
    jest.clearAllMocks();
    (buildVideoJobTerminalHtml as jest.Mock).mockReturnValue('<html>body</html>');
  });

  it('should send email for job.done', async () => {
    await service.notify({
      to: 'user@user.com',
      recipientName: 'user',
      jobId: '11111111-1111-4111-8111-111111111111',
      fileName: 'clip.mp4',
      webAppBaseUrl: 'http://localhost:5173',
      event: {
        type: JOB_EVENT_TYPES.done,
        jobId: '11111111-1111-4111-8111-111111111111',
        userId: 1,
        zipKey: 'zips/1/x.zip',
        frameCount: 12
      }
    });

    expect(buildVideoJobTerminalHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientName: 'user',
        fileName: 'clip.mp4',
        subject: 'Seu vídeo foi convertido',
        detailText: '12 frame(s) gerado(s).',
        jobUrl: 'http://localhost:5173/jobs/11111111-1111-4111-8111-111111111111'
      })
    );
    expect(mockEmailSender.send).toHaveBeenCalledWith({
      to: 'user@user.com',
      subject: '4Frames — Seu vídeo foi convertido',
      body: '<html>body</html>'
    });
  });

  it('should send email for job.failed with reason', async () => {
    await service.notify({
      to: 'user@user.com',
      recipientName: 'user',
      jobId: '11111111-1111-4111-8111-111111111111',
      fileName: 'clip.mp4',
      webAppBaseUrl: 'http://localhost:5173',
      event: {
        type: JOB_EVENT_TYPES.failed,
        jobId: '11111111-1111-4111-8111-111111111111',
        userId: 1,
        reason: 'Vídeo inválido'
      }
    });

    expect(buildVideoJobTerminalHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        detailText: 'Motivo: Vídeo inválido',
        subject: 'Falha na conversão do vídeo'
      })
    );
  });
});
