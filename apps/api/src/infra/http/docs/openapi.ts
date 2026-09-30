import { authPaths } from './paths/auth';
import { mergePaths } from './paths/merge-paths';
import { systemPaths } from './paths/system';
import { videoPaths } from './paths/video';
import { responses } from './responses';
import { schemas } from './schemas/';

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: '4Frames Core API',
    description:
      'API REST do 4Frames: login com JWT, jobs de conversão de vídeo em frames com upload e download por URL ' +
      'pré-assinada do S3, listagem de status e progresso em tempo real (SSE).',
    version: '1.0.0'
  },

  servers: [
    {
      url: process.env.SERVER_URL ?? '/'
    }
  ],
  tags: [
    {
      name: 'auth',
      description: 'Autenticação de usuários'
    },
    {
      name: 'system',
      description: 'Endpoints de sistema'
    },
    {
      name: 'video',
      description: 'Upload e processamento de vídeos'
    }
  ],
  paths: mergePaths(authPaths, systemPaths, videoPaths),
  components: {
    schemas,
    responses,
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    }
  }
};
