import { z } from 'zod';

// Limite alinhado ao worker (job de vídeo único, processamento em memória/streaming limitado) — ver ADR-001, seção 4.2.
export const MAX_VIDEO_FILE_SIZE_BYTES = 500 * 1024 * 1024;

export const ALLOWED_VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;

const createVideoJobSchema = z.object({
  fileName: z.string('Nome do arquivo deve ser uma string').min(1, 'Nome do arquivo é obrigatório'),

  fileSize: z
    .number('Tamanho do arquivo deve ser um número')
    .positive('Tamanho do arquivo deve ser maior que zero')
    .max(MAX_VIDEO_FILE_SIZE_BYTES, 'Tamanho do arquivo excede o limite de 500MB'),

  contentType: z.enum(ALLOWED_VIDEO_CONTENT_TYPES, {
    error: 'Tipo de conteúdo inválido. Permitidos: video/mp4, video/quicktime'
  })
});

export default createVideoJobSchema;
