import path from 'node:path';

export interface Credentials {
  email: string;
  password: string;
}

const password = process.env.E2E_PASSWORD ?? '123456';

/**
 * Endereços da stack no cluster local, como o navegador os vê, e usuários do seed. Os jobs ficam com o
 * `user@user.com`, para não aparecerem na listagem do admin; o admin é o "outro usuário" do 404.
 */
export const config = {
  apiUrl: process.env.API_URL ?? 'http://localhost:8080/api',
  mailpitUrl: process.env.MAILPIT_URL ?? 'http://localhost:8025',
  user: { email: process.env.E2E_USER ?? 'user@user.com', password } satisfies Credentials,
  otherUser: { email: process.env.E2E_OTHER_USER ?? 'admin@admin.com', password } satisfies Credentials,
  fixturesDir: path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'worker', 'test', 'fixtures'),
  /** Vídeo de 30 s: com a regra do projeto base (1 frame por segundo), 30 PNGs. */
  validVideo: 'ex-30sec-video.mp4',
  validVideoFrames: 30,
  /** Uma imagem renomeada para .mp4: o worker a recusa. */
  invalidVideo: 'ex-invalid-video.mp4'
};
