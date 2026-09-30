import { JOB_EVENT_TYPES } from '@4frames/shared/jobs';

export type TerminalJobEventType = typeof JOB_EVENT_TYPES.done | typeof JOB_EVENT_TYPES.failed;

interface VideoJobEmailContent {
  subject: string;
  heading: string;
  message: string;
  color: string;
}

export const VIDEO_JOB_EMAIL_MAP: Record<TerminalJobEventType, VideoJobEmailContent> = {
  [JOB_EVENT_TYPES.done]: {
    subject: 'Seu vídeo foi convertido',
    heading: 'Conversão finalizada',
    message: 'A extração de frames terminou com sucesso. Você já pode baixar o arquivo .zip pelo link abaixo.',
    color: '#166534'
  },
  [JOB_EVENT_TYPES.failed]: {
    subject: 'Falha na conversão do vídeo',
    heading: 'Não foi possível converter',
    message:
      'Ocorreu um erro ao processar seu vídeo. Você pode ver os detalhes na página do job ou tentar enviar o arquivo novamente.',
    color: '#b91c1c'
  }
};
