import { authPaths } from './paths/auth';
import { systemPaths } from './paths/system';
import { responses } from './responses';
import { schemas } from './schemas/';

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: '4Frames Core API',
    description: 'API REST do núcleo 4Frames — autenticação de funcionários via JWT.',
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
    }
  ],
  paths: {
    ...authPaths,
    ...systemPaths
  },
  components: {
    schemas,
    responses
  }
};
