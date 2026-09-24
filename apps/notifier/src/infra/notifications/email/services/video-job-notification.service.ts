import { JOB_EVENT_TYPES, type JobDoneEvent, type JobFailedEvent } from '@4frames/shared/jobs';

import { VIDEO_JOB_EMAIL_MAP } from '@/infra/notifications/email/templates/video-job/video-job-content';
import { buildVideoJobTerminalHtml } from '@/infra/notifications/email/templates/video-job/video-job-template';
import { type INotificationSender } from '@/ports/notification-sender.interface';

export interface VideoJobNotificationInput {
  to: string;
  recipientName: string;
  jobId: string;
  fileName: string;
  webAppBaseUrl: string;
  event: JobDoneEvent | JobFailedEvent;
}

export class VideoJobNotificationService {
  constructor(private readonly emailSender: INotificationSender) {}

  public async notify(input: VideoJobNotificationInput): Promise<void> {
    const emailContent = VIDEO_JOB_EMAIL_MAP[input.event.type];
    const jobUrl = new URL(`/jobs/${input.jobId}`, input.webAppBaseUrl).toString();

    const detailText =
      input.event.type === JOB_EVENT_TYPES.failed
        ? `Motivo: ${input.event.reason}`
        : input.event.type === JOB_EVENT_TYPES.done
          ? `${input.event.frameCount} frame(s) gerado(s).`
          : undefined;

    const html = buildVideoJobTerminalHtml({
      recipientName: input.recipientName,
      jobId: input.jobId,
      fileName: input.fileName,
      jobUrl,
      detailText,
      ...emailContent
    });

    await this.emailSender.send({
      to: input.to,
      subject: `4Frames — ${emailContent.subject}`,
      body: html
    });
  }
}
