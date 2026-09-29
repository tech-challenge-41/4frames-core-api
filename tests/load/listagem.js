/**
 * Usuários com a tela "Meus vídeos" aberta durante o pico: cada VU consulta GET /videos a cada 3 s, como o
 * polling do front. Nenhuma requisição pode falhar enquanto o KEDA sobe e desce workers.
 *
 * Roda no container grafana/k6, chamado por run-scenario.sh, em paralelo com uploads.js.
 */
import { check, fail, sleep } from 'k6';
import http from 'k6/http';

const API_URL = __ENV.API_URL || 'http://host.docker.internal:8080/api';
const USERS = Number(__ENV.USERS || 10);
const DURATION = __ENV.DURATION || '3m';
const EMAIL = __ENV.EMAIL || 'user@user.com';
const PASSWORD = __ENV.PASSWORD || '123456';

export const options = {
  scenarios: {
    listagem: { executor: 'constant-vus', vus: USERS, duration: DURATION }
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1']
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(95)', 'max']
};

export function setup() {
  const response = http.post(API_URL + '/auth/login', JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' }
  });

  if (response.status !== 201) {
    fail('login respondeu ' + response.status);
  }

  return { token: response.json('accessToken') };
}

export default function (data) {
  const response = http.get(API_URL + '/videos?limit=20', {
    headers: { Authorization: 'Bearer ' + data.token },
    tags: { name: 'GET /videos' }
  });

  check(response, { 'GET /videos → 200': r => r.status === 200 });
  sleep(3);
}
