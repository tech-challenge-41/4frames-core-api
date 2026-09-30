// Cria ou atualiza no Datadog o dashboard e os monitores versionados em infra/datadog/.
//
// Uso, na raiz do repositório (Node 24):
//   node --env-file=.env scripts/datadog-apply.mjs            aplica
//   node --env-file=.env scripts/datadog-apply.mjs --dry-run  só valida os arquivos e mostra o que faria
//
// Precisa de DD_API_KEY e DD_APP_KEY (Organization Settings → Application Keys) e usa o DD_SITE (padrão us5).
// O dashboard é achado pelo título e cada monitor pelo nome: rodar de novo atualiza, não duplica. O que for
// mudado na tela do Datadog é sobrescrito no próximo apply; mude o JSON.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATADOG_DIR = path.join(ROOT, 'infra', 'datadog');
const SITE = process.env.DD_SITE || 'us5.datadoghq.com';
const DRY_RUN = process.argv.includes('--dry-run');

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(ROOT, file)}: ${error.message}`);
  }
}

function assertFields(label, object, fields) {
  const missing = fields.filter(field => object[field] === undefined || object[field] === '');

  if (missing.length > 0) {
    throw new Error(`${label}: faltam ${missing.join(', ')}`);
  }
}

async function api(method, pathname, body) {
  const response = await fetch(`https://api.${SITE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': process.env.DD_API_KEY,
      'DD-APPLICATION-KEY': process.env.DD_APP_KEY
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${method} ${pathname}: ${response.status} ${text}`);
  }

  return text ? JSON.parse(text) : undefined;
}

async function findDashboardId(title) {
  const pageSize = 100;

  for (let start = 0; ; start += pageSize) {
    const { dashboards = [] } = await api('GET', `/api/v1/dashboard?count=${pageSize}&start=${start}`);
    const found = dashboards.find(dashboard => dashboard.title === title);

    if (found) return found.id;
    if (dashboards.length < pageSize) return undefined;
  }
}

async function findMonitorId(name) {
  const monitors = await api('GET', `/api/v1/monitor?name=${encodeURIComponent(name)}`);
  return monitors.find(monitor => monitor.name === name)?.id;
}

async function main() {
  const dashboard = await readJson(path.join(DATADOG_DIR, 'dashboard.json'));
  assertFields('dashboard.json', dashboard, ['title', 'layout_type', 'widgets']);

  const monitorFiles = (await readdir(path.join(DATADOG_DIR, 'monitors')))
    .filter(file => file.endsWith('.json'))
    .sort();
  const monitors = [];

  for (const file of monitorFiles) {
    const monitor = await readJson(path.join(DATADOG_DIR, 'monitors', file));
    assertFields(`monitors/${file}`, monitor, ['name', 'type', 'query', 'message']);
    monitors.push(monitor);
  }

  if (DRY_RUN) {
    console.log(`Dashboard "${dashboard.title}" com ${dashboard.widgets.length} widgets`);

    for (const monitor of monitors) {
      console.log(`Monitor "${monitor.name}": ${monitor.query}`);
    }

    console.log(`Arquivos válidos. Sem --dry-run, eles seriam aplicados em https://app.${SITE}`);
    return;
  }

  if (!process.env.DD_API_KEY || !process.env.DD_APP_KEY) {
    throw new Error('DD_API_KEY e DD_APP_KEY são necessárias (rode com node --env-file=.env)');
  }

  const dashboardId = await findDashboardId(dashboard.title);
  const saved = dashboardId
    ? await api('PUT', `/api/v1/dashboard/${dashboardId}`, dashboard)
    : await api('POST', '/api/v1/dashboard', dashboard);
  console.log(
    `Dashboard "${dashboard.title}" ${dashboardId ? 'atualizado' : 'criado'}: https://app.${SITE}${saved.url}`
  );

  for (const monitor of monitors) {
    const monitorId = await findMonitorId(monitor.name);
    const result = monitorId
      ? await api('PUT', `/api/v1/monitor/${monitorId}`, monitor)
      : await api('POST', '/api/v1/monitor', monitor);
    console.log(
      `Monitor "${monitor.name}" ${monitorId ? 'atualizado' : 'criado'}: https://app.${SITE}/monitors/${result.id}`
    );
  }
}

main().catch(error => {
  console.error(`Erro: ${error.message}`);
  process.exit(1);
});
