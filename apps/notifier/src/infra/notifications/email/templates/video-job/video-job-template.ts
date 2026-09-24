import { renderPugTemplate } from '@/infra/notifications/email/renderer/pug-renderer';

export interface BuildVideoJobEmailHtmlParams {
  recipientName: string;
  jobId: string;
  fileName: string;
  subject: string;
  heading: string;
  message: string;
  color: string;
  jobUrl: string;
  detailText?: string;
}

const VIDEO_JOB_TERMINAL_TEMPLATE_PATH = 'infra/notifications/email/templates/video-job/video-job-terminal.pug';

export function buildVideoJobTerminalHtml(params: BuildVideoJobEmailHtmlParams): string {
  return renderPugTemplate(VIDEO_JOB_TERMINAL_TEMPLATE_PATH, params);
}
