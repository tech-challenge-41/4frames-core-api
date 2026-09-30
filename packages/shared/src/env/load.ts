// Import de efeito colateral: `import '@4frames/shared/env/load'` como primeira linha do entrypoint
// carrega o .env da raiz do monorepo antes de qualquer módulo ler process.env.
import { loadEnv } from './index';

loadEnv();
