/**
 * Gráfico (timeline.svg) e resumo (resumo.md) de um cenário de carga, a partir do que run-scenario.sh e
 * sampler.mjs gravaram. Sai com 1 se algum vídeo não chegou a DONE ou se algum limite do k6 falhou.
 *
 * Uso: node tests/load/chart.mjs <pasta> <nome> <máximo de workers> <vídeos> [status do k6 uploads] [status da listagem]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadScenario } from './scenario-data.mjs';

const [outDir, name, maxArg, videosArg, uploadsStatusArg = '0', listagemStatusArg = '0'] = process.argv.slice(2);
const maxReplicas = Number(maxArg);
const videos = Number(videosArg);
const scenario = loadScenario(outDir);
const { numbers } = scenario;

const uploadsOk =
  uploadsStatusArg === '0' && numbers.uploads && numbers.uploads.failed === 0 && numbers.uploads.checksFailed === 0;
const listagemOk =
  listagemStatusArg === '0' && numbers.listagem && numbers.listagem.failed === 0 && numbers.listagem.checksFailed === 0;
const nothingLost = numbers.created === videos && numbers.done === videos;

// ---------------------------------------------------------------- gráfico: dois painéis, o mesmo eixo do tempo

const WIDTH = 960;
const MARGIN = { left: 56, right: 150, top: 96 };
const PANEL_HEIGHT = 150;
const PANEL_GAP = 84;
const plotRight = WIDTH - MARGIN.right;
const x = s => MARGIN.left + (s / scenario.duration) * (plotRight - MARGIN.left);

/** Cada entidade tem um slot fixo da paleta categórica, na ordem: a cor nunca muda de dono. */
const SERIES = {
  ready: { slot: 1, label: 'workers prontos' },
  terminating: { slot: 2, label: 'workers em encerramento' },
  done: { slot: 3, label: 'vídeos concluídos' },
  waiting: { slot: 4, label: 'na fila' },
  processing: { slot: 5, label: 'em processamento' }
};

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Números em pt-BR, como no resto da documentação: 126,4 s e 15.435 ms.
const round = value => (Math.round(value * 10) / 10).toLocaleString('pt-BR');
const niceStep = max => (max <= 6 ? 1 : max <= 12 ? 2 : Math.ceil(max / 6));

function linePath(points, y, stepped) {
  let d = `M${x(points[0][0]).toFixed(1)},${y(points[0][1]).toFixed(1)}`;

  for (const [s, value] of points.slice(1)) {
    d += stepped ? `H${x(s).toFixed(1)}V${y(value).toFixed(1)}` : `L${x(s).toFixed(1)},${y(value).toFixed(1)}`;
  }

  return stepped ? d + `H${x(scenario.duration).toFixed(1)}` : d;
}

/** Um painel com eixo y próprio (0..yMax), grade, legenda em uma linha e as séries. */
function panel(top, title, yMax, series) {
  const y = value => top + PANEL_HEIGHT - (value / yMax) * PANEL_HEIGHT;
  const parts = [`<text class="panel-title" x="${MARGIN.left}" y="${top - 42}">${escape(title)}</text>`];
  let legendX = MARGIN.left;

  // A legenda fica sempre: a identidade de uma série nunca depende só da cor.
  for (const { key } of series) {
    const { slot, label } = SERIES[key];

    parts.push(
      `<line class="s${slot}" x1="${legendX}" x2="${legendX + 16}" y1="${top - 24}" y2="${top - 24}"/>` +
        `<text class="legend" x="${legendX + 22}" y="${top - 20}">${escape(label)}</text>`
    );
    legendX += 22 + label.length * 7 + 24;
  }

  for (let value = 0; value <= yMax; value += niceStep(yMax)) {
    parts.push(
      `<line class="${value === 0 ? 'baseline' : 'grid'}" x1="${MARGIN.left}" x2="${plotRight}" y1="${y(value)}" y2="${y(value)}"/>` +
        `<text class="tick" x="${MARGIN.left - 8}" y="${y(value) + 4}" text-anchor="end">${value}</text>`
    );
  }

  for (const { key, points, stepped, endLabel, peakLabel } of series.filter(item => item.points.length)) {
    const { slot, label } = SERIES[key];
    const last = points[points.length - 1][1];

    parts.push(`<path class="s${slot}" d="${linePath(points, y, stepped)}"><title>${escape(label)}</title></path>`);

    if (peakLabel) {
      // No primeiro ponto do pico, logo acima da linha.
      const [peakS, peak] = points.reduce((best, point) => (point[1] > best[1] ? point : best));

      parts.push(`<text class="end" x="${x(peakS) + 6}" y="${y(peak) - 6}">${escape(peakLabel(peak))}</text>`);
    }

    if (endLabel) {
      parts.push(
        `<circle class="dot s${slot}" cx="${x(scenario.duration)}" cy="${y(last)}" r="4"/>` +
          `<text class="end" x="${x(scenario.duration) + 10}" y="${y(last) + 4}">${escape(endLabel(last))}</text>`
      );
    }
  }

  return parts.join('\n');
}

// Uma faixa para os marcos do cenário, acima dos painéis; cada painel tem título e legenda acima da área.
const marksY = MARGIN.top - 8;
const panel1Top = MARGIN.top + 60;
const panel2Top = panel1Top + PANEL_HEIGHT + PANEL_GAP;
const bottom = panel2Top + PANEL_HEIGHT;
const yMax1 = Math.max(maxReplicas, numbers.peakReady, numbers.peakTerminating, 1);

// Os marcos: numerados na faixa do alto, explicados embaixo do gráfico. Um número colado no anterior desliza
// para a direita, para os dois continuarem legíveis; a linha fica no instante certo.
const MARK_SPACING = 20;
const marks = scenario.events.slice(1).map((event, index) => ({ n: index + 1, ...event }));
let previousMarkX = -Infinity;
// A linha de cada marco cruza só as áreas dos painéis, sem passar por cima dos títulos e das legendas.
const markSvg = marks.map(({ n, s }) => {
  const markX = Math.max(x(s), previousMarkX + MARK_SPACING);

  previousMarkX = markX;

  return (
    `<line class="mark" x1="${x(s)}" x2="${x(s)}" y1="${panel1Top}" y2="${panel1Top + PANEL_HEIGHT}"/>` +
    `<line class="mark" x1="${x(s)}" x2="${x(s)}" y1="${panel2Top}" y2="${bottom}"/>` +
    `<circle class="mark-dot" cx="${markX}" cy="${marksY}" r="8"/>` +
    `<text class="mark-n" x="${markX}" y="${marksY + 4}" text-anchor="middle">${n}</text>`
  );
});

const xStep = scenario.duration > 300 ? 60 : 30;
const xTicks = [];

for (let s = 0; s <= scenario.duration; s += xStep) {
  xTicks.push(`<text class="tick" x="${x(s)}" y="${bottom + 20}" text-anchor="middle">${s}</text>`);
}

const plural = (value, word) => `${value} ${word}${value === 1 ? '' : 's'}`;
const title = `${videos} vídeos ao mesmo tempo, com o KEDA limitado a ${plural(maxReplicas, 'worker')}`;
const errors = (numbers.uploads?.failed ?? 0) + (numbers.listagem?.failed ?? 0);
const subtitle = [
  `${numbers.done} de ${videos} concluídos`,
  `drenagem em ${round(numbers.drainSeconds)} s`,
  `pico de ${plural(numbers.peakReady, 'worker')}`,
  `${errors} requisições com erro`
].join('  ·  ');

const captionY = bottom + 48;
const caption = marks.map(
  (mark, index) =>
    `<text class="caption" x="${MARGIN.left}" y="${captionY + index * 18}">` +
    `${mark.n}  ${escape(mark.text)} (${round(mark.s)} s)</text>`
);
const height = captionY + marks.length * 18 + 16;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">${escape(title)}</title>
<desc id="d">${escape(subtitle)}. Dados em replicas.log, pods-events.log, queue.csv, jobs.csv e events.log.</desc>
<style>
  svg { --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781; --grid: #e1e0d9; --axis: #c3c2b7;
        --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; }
  @media (prefers-color-scheme: dark) {
    svg { --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --axis: #383835;
          --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; }
  }
  text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--ink-2); font-size: 12px; }
  .title { fill: var(--ink); font-size: 18px; font-weight: 600; }
  .subtitle { font-size: 13px; }
  .panel-title { fill: var(--ink); font-size: 13px; font-weight: 600; }
  .tick, .caption { fill: var(--muted); font-variant-numeric: tabular-nums; }
  .end { fill: var(--ink); font-weight: 600; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .baseline, .mark { stroke: var(--axis); stroke-width: 1; }
  .mark-dot { fill: var(--surface); stroke: var(--axis); stroke-width: 1; }
  .mark-n { fill: var(--ink-2); font-size: 10px; font-weight: 600; }
  path, line[class^="s"] { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .dot { stroke: var(--surface); stroke-width: 2; }
  .s1 { stroke: var(--s1); } .s2 { stroke: var(--s2); } .s3 { stroke: var(--s3); }
  .s4 { stroke: var(--s4); } .s5 { stroke: var(--s5); }
  circle.s1 { fill: var(--s1); } circle.s3 { fill: var(--s3); }
</style>
<rect width="100%" height="100%" fill="var(--surface)"/>
<text class="title" x="${MARGIN.left}" y="36">${escape(title)}</text>
<text class="subtitle" x="${MARGIN.left}" y="60">${escape(subtitle)}</text>
${markSvg.join('\n')}
${panel(panel1Top, 'Workers (réplicas do Deployment, decididas pelo KEDA)', yMax1, [
  { key: 'ready', points: scenario.series.ready, stepped: true, peakLabel: peak => `pico: ${peak}` },
  ...(numbers.peakTerminating ? [{ key: 'terminating', points: scenario.series.terminating, stepped: true }] : [])
])}
${panel(panel2Top, 'Vídeos do pico (fila SQS e status no banco)', videos, [
  { key: 'done', points: scenario.series.done, stepped: true, endLabel: last => `${last} de ${videos}` },
  { key: 'waiting', points: scenario.series.waiting },
  { key: 'processing', points: scenario.series.processing }
])}
${xTicks.join('\n')}
<text class="tick" x="${plotRight}" y="${bottom + 36}" text-anchor="end">segundos desde o início</text>
${caption.join('\n')}
</svg>
`;

writeFileSync(path.join(outDir, 'timeline.svg'), svg);

// ---------------------------------------------------------------- resumo

const yes = value => (value ? 'sim' : '**não**');
const ms = value => (value === undefined ? '–' : `${Math.round(value).toLocaleString('pt-BR')} ms`);
const seconds = value => (value === undefined ? '–' : `${round(value)} s`);
const count = k6 => (k6 ? `${k6.requests} / ${k6.failed}` : '–');
const latency = value => (value ? `${ms(value.med)} / ${ms(value.p95)}` : '–');
const resumo = `# ${name}

${title}.

![Workers e vídeos ao longo do cenário](timeline.svg)

| | |
|---|---|
| Vídeos enviados / concluídos / com falha | ${numbers.created} / ${numbers.done} / ${numbers.failed} |
| Nenhum vídeo perdido (todos em DONE) | ${yes(nothingLost)} |
| Drenagem (primeiro job criado → último concluído) | ${seconds(numbers.drainSeconds)} |
| Primeiro worker extra pedido pelo KEDA | ${seconds(numbers.firstScaleUpSeconds)} |
| Pico de workers prontos | ${numbers.peakReady} |
| Pico de workers em encerramento | ${numbers.peakTerminating} |
| Workers de volta ao mínimo | ${seconds(numbers.backToMinSeconds)} |
| Uploads no k6: requisições / com erro | ${count(numbers.uploads)} |
| API no pico, \`POST /videos\`: mediana / p95 | ${latency(numbers.uploads?.create)} |
| API no pico, \`POST /videos/:jobId/complete\`: mediana / p95 | ${latency(numbers.uploads?.complete)} |
| \`PUT\` de cada vídeo no S3, todos ao mesmo tempo: mediana / p95 | ${latency(numbers.uploads?.s3)} |
| Listagem durante o pico (\`GET /videos\` a cada 3 s): requisições / com erro | ${count(numbers.listagem)} |
| Listagem durante o pico: mediana / p95 | ${latency(numbers.listagem?.all)} |
| Limites do k6 (0 erros, todos os checks) | uploads: ${yes(uploadsOk)} · listagem: ${yes(listagemOk)} |

Marcos (segundos desde o início):

${scenario.events.map(event => `- ${round(event.s)} s: ${event.text}`).join('\n')}

Arquivos: \`pods-watch.log\` (os pods do worker, evento a evento, com o horário), \`replicas.log\`, \`queue.csv\`,
\`jobs.csv\`, \`k6-uploads.json\`/\`.txt\` e \`k6-listagem.json\`/\`.txt\`${
  scenario.hasWorkerLogs ? ', e `worker-*.log`, com o log inteiro de cada worker que estava de pé na redução' : ''
}.
`;

writeFileSync(path.join(outDir, 'resumo.md'), resumo);
console.log(resumo);

if (!nothingLost || !uploadsOk || !listagemOk) {
  console.error('O cenário não passou: veja o resumo acima.');
  process.exit(1);
}
