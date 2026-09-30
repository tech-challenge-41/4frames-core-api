/** Estados do job, na mesma ordem do enum `VideoJobStatus` do Prisma (ver ADR-001, "Estados do job"). */
export const VIDEO_JOB_STATUSES = ['UPLOAD_PENDING', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'EXPIRED'] as const;

export type VideoJobStatusName = (typeof VIDEO_JOB_STATUSES)[number];

export const TERMINAL_VIDEO_JOB_STATUSES: readonly VideoJobStatusName[] = ['DONE', 'FAILED', 'EXPIRED'];

export function isVideoJobStatus(value: string): value is VideoJobStatusName {
  return (VIDEO_JOB_STATUSES as readonly string[]).includes(value);
}

export function isTerminalVideoJobStatus(status: string): boolean {
  return (TERMINAL_VIDEO_JOB_STATUSES as readonly string[]).includes(status);
}
