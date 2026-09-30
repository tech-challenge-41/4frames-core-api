/**
 * Pico de uploads: cada VU faz, ao mesmo tempo, o fluxo do front para um vídeo. POST /videos → PUT direto no S3
 * pela URL pré-assinada → POST /videos/:jobId/complete. Nenhuma requisição pode falhar.
 *
 * Roda no container grafana/k6, chamado por run-scenario.sh. De dentro do container, o host é
 * host.docker.internal. A API assina a URL de upload para o endereço público do S3 (localhost:4566, o que o
 * navegador alcança): o PUT vai para host.docker.internal:4566 com o Host original, que entra na assinatura.
 */
import { check, fail } from 'k6';
import http from 'k6/http';

const API_URL = __ENV.API_URL || 'http://host.docker.internal:8080/api';
const S3_SIGNED_ORIGIN = __ENV.S3_SIGNED_ORIGIN || 'http://localhost:4566';
const S3_REACHABLE_ORIGIN = __ENV.S3_REACHABLE_ORIGIN || 'http://host.docker.internal:4566';
const RUN_ID = __ENV.RUN_ID || 'k6-' + Date.now();
const VIDEOS = Number(__ENV.VIDEOS || 10);
const EMAIL = __ENV.EMAIL || 'user@user.com';
const PASSWORD = __ENV.PASSWORD || '123456';

const video = open(__ENV.VIDEO || '/fixtures/ex-30sec-video.mp4', 'b');

export const options = {
  scenarios: {
    uploads: { executor: 'per-vu-iterations', vus: VIDEOS, iterations: 1, maxDuration: '5m' }
  },
  thresholds: {
    'http_req_failed': ['rate==0'],
    'checks': ['rate==1'],
    // Separam no resumo a latência da API da do PUT de cada vídeo no S3, que leva segundos.
    'http_req_duration{name:POST /videos}': ['p(95)<5000'],
    'http_req_duration{name:POST /videos/:jobId/complete}': ['p(95)<5000'],
    'http_req_duration{name:PUT S3 (URL pré-assinada)}': ['p(95)<120000']
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(95)', 'max']
};

const json = { headers: { 'Content-Type': 'application/json' } };

/** Um login para o pico todo: o rate limiter de /auth conta 100 por IP a cada 15 min. */
export function setup() {
  const response = http.post(API_URL + '/auth/login', JSON.stringify({ email: EMAIL, password: PASSWORD }), json);

  if (response.status !== 201) {
    fail('login respondeu ' + response.status);
  }

  return { token: response.json('accessToken') };
}

export default function (data) {
  const auth = { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + data.token } };
  const fileName = RUN_ID + '-' + String(__VU).padStart(3, '0') + '.mp4';

  const created = http.post(
    API_URL + '/videos',
    JSON.stringify({ fileName, fileSize: video.byteLength, contentType: 'video/mp4' }),
    Object.assign({ tags: { name: 'POST /videos' } }, auth)
  );

  if (!check(created, { 'POST /videos → 201': r => r.status === 201 })) {
    return;
  }

  const job = created.json();
  const uploaded = http.put(job.uploadUrl.replace(S3_SIGNED_ORIGIN, S3_REACHABLE_ORIGIN), video, {
    headers: { 'Content-Type': 'video/mp4', 'Host': S3_SIGNED_ORIGIN.replace(/^https?:\/\//, '') },
    tags: { name: 'PUT S3 (URL pré-assinada)' },
    timeout: '120s'
  });

  if (!check(uploaded, { 'PUT no S3 → 200': r => r.status === 200 })) {
    return;
  }

  const completed = http.post(
    API_URL + '/videos/' + job.jobId + '/complete',
    null,
    Object.assign({ tags: { name: 'POST /videos/:jobId/complete' } }, auth)
  );

  check(completed, { 'POST /complete → 200 QUEUED': r => r.status === 200 && r.json('status') === 'QUEUED' });
}
