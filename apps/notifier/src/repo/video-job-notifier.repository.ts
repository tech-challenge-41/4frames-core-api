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

  /**
   * Reserva o job para notificação: grava `notified_at` numa escrita condicional a
   * `notified_at IS NULL` e status terminal. Devolve `true` só para quem ganhou a corrida — com
   * mais de uma réplica, ou com o evento do Redis e a varredura caindo no mesmo job ao mesmo
   * tempo, as outras recebem `false` e não enviam nada.
   *
   * O claim vem ANTES do envio de propósito: marcar depois deixa uma janela entre enviar e marcar
   * em que dois processos mandam o mesmo e-mail (era o que acontecia com o `markNotified`).
   */
  public async claimForNotify(jobId: string): Promise<boolean> {
    const result = await prisma.video_jobs.updateMany({
      where: { id: jobId, notified_at: null, status: { in: ['DONE', 'FAILED'] } },
      data: { notified_at: new Date() }
    });

    return result.count === 1;
  }

  /**
   * Devolve o job à fila de notificação quando o envio falhou depois do claim, para a varredura
   * periódica tentar de novo. Só quem acabou de ganhar o claim chama isso.
   */
  public async releaseClaim(jobId: string): Promise<void> {
    await prisma.video_jobs.updateMany({
      where: { id: jobId },
      data: { notified_at: null }
    });
  }
}
