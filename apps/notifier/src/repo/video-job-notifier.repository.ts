import { prisma, type VideoJobStatus } from '@4frames/shared/prisma';

export interface NotifyJobContext {
  jobId: string;
  userId: number;
  userEmail: string;
  fileName: string;
  status: VideoJobStatus;
  failureReason: string | null;
  frameCount: number | null;
  notifiedAt: Date | null;
}

export class PrismaVideoJobNotifierRepository {
  public async findForNotify(jobId: string): Promise<NotifyJobContext | null> {
    const row = await prisma.video_jobs.findUnique({
      where: { id: jobId },
      include: { user: { select: { email: true, status: true } } }
    });

    if (!row || row.user.status !== 'ACTIVE') {
      return null;
    }

    return {
      jobId: row.id,
      userId: row.user_id,
      userEmail: row.user.email,
      fileName: row.file_name,
      status: row.status,
      failureReason: row.failure_reason,
      frameCount: row.frame_count,
      notifiedAt: row.notified_at
    };
  }

  public async listUnnotifiedTerminal(limit: number): Promise<NotifyJobContext[]> {
    const rows = await prisma.video_jobs.findMany({
      where: {
        status: { in: ['DONE', 'FAILED'] },
        notified_at: null
      },
      orderBy: { updated_at: 'asc' },
      take: limit,
      include: { user: { select: { email: true, status: true } } }
    });

    return rows
      .filter(row => row.user.status === 'ACTIVE')
      .map(row => ({
        jobId: row.id,
        userId: row.user_id,
        userEmail: row.user.email,
        fileName: row.file_name,
        status: row.status,
        failureReason: row.failure_reason,
        frameCount: row.frame_count,
        notifiedAt: row.notified_at
      }));
  }

  /** Só atualiza se ainda não foi notificado (idempotência). */
  public async markNotified(jobId: string): Promise<boolean> {
    const result = await prisma.video_jobs.updateMany({
      where: { id: jobId, notified_at: null },
      data: { notified_at: new Date() }
    });

    return result.count > 0;
  }
}
