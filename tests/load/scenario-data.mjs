/**
 * Lê o que run-scenario.sh e sampler.mjs gravaram na pasta de um cenário e monta as séries do gráfico e os
 * números do resumo. Os tempos das séries são segundos desde o primeiro marco do events.log.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function readLines(outDir, file) {
  const fullPath = path.join(outDir, file);

  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8').split(/\r?\n/).filter(Boolean) : [];
}

function readJson(outDir, file) {
  const fullPath = path.join(outDir, file);

  return existsSync(fullPath) ? JSON.parse(readFileSync(fullPath, 'utf8')) : undefined;
}

/** Números de um `--summary-export` do k6. No `http_req_failed`, `passes` conta as requisições que falharam. */
function k6Numbers(summary) {
  if (!summary) {
    return undefined;
  }

  const { metrics } = summary;
  // As submétricas por tag só existem quando o script tem um threshold nelas (ver uploads.js).
  const latency = key => metrics[key] && { med: metrics[key].med, p95: metrics[key]['p(95)'] };

  return {
    requests: metrics.http_reqs?.count ?? 0,
    failed: metrics.http_req_failed?.passes ?? 0,
    checksFailed: metrics.checks?.fails ?? 0,
    all: latency('http_req_duration'),
    create: latency('http_req_duration{name:POST /videos}'),
    complete: latency('http_req_duration{name:POST /videos/:jobId/complete}'),
    s3: latency('http_req_duration{name:PUT S3 (URL pré-assinada)}')
  };
}

/**
 * O amostrador começa alguns segundos antes do marco "início": a série passa a começar em 0, com o último valor
 * de antes dele.
 */
function fromZero(points) {
  const before = points.filter(([s]) => s <= 0);

  return [...(before.length ? [[0, before[before.length - 1][1]]] : []), ...points.filter(([s]) => s > 0)];
}

/** Quantos pods do worker estão em encerramento a cada evento do `kubectl get pods -w`. */
function terminatingSeries(podEvents, seconds) {
  const leaving = new Set();
  const points = [[0, 0]];

  for (const event of podEvents) {
    if (event.type === 'DELETED') {
      leaving.delete(event.pod);
    } else if (event.status === 'Terminating') {
      leaving.add(event.pod);
    }

    points.push([seconds(event.ms), leaving.size]);
  }

  return points;
}

export function loadScenario(outDir) {
  const events = readLines(outDir, 'events.log').map(line => {
    const space = line.indexOf(' ');

    return { ms: Number(line.slice(0, space)), text: line.slice(space + 1) };
  });
  const replicas = readLines(outDir, 'replicas.log').map(line => {
    const [ms, desired, ready] = line.split(' ').map(Number);

    return { ms, desired, ready };
  });
  const queue = readLines(outDir, 'queue.csv')
    .slice(1)
    .map(line => {
      const [ms, visible, inflight] = line.split(',').map(Number);

      return { ms, visible, inflight };
    });
  const jobs = readLines(outDir, 'jobs.csv')
    .slice(1)
    .map(line => {
      const [file, status, created, updated, ...reason] = line.split(',');

      return { file, status, created: Number(created), updated: Number(updated), reason: reason.join(',') };
    });
  const podEvents = readLines(outDir, 'pods-events.log')
    .map(line => line.trim().split(/\s+/))
    // `<ms> EVENTO NOME PRONTOS STATUS ...`; o cabeçalho do kubectl fica de fora.
    .filter(fields => /^\d+$/.test(fields[0]) && fields[1] !== 'EVENT')
    .map(([ms, type, pod, , status]) => ({ ms: Number(ms), type, pod, status }));

  const start = events[0]?.ms ?? replicas[0]?.ms ?? Date.now();
  const lastMs = Math.max(
    start + 10_000,
    ...events.map(e => e.ms),
    ...replicas.map(r => r.ms),
    ...queue.map(q => q.ms)
  );
  const seconds = ms => (ms - start) / 1000;

  const doneJobs = jobs.filter(job => job.status === 'DONE');
  const done = [
    [0, 0],
    ...doneJobs
      .map(job => seconds(job.updated))
      .sort((a, b) => a - b)
      .map((s, i) => [s, i + 1])
  ];
  const terminating = terminatingSeries(podEvents, seconds);
  const firstScaleUp = replicas.find(r => r.desired > 1);
  const backToMin = events.find(e => e.text.startsWith('workers de volta'));

  return {
    seconds,
    duration: seconds(lastMs) + 5,
    events: events.map(event => ({ s: seconds(event.ms), text: event.text })),
    series: {
      ready: fromZero(replicas.map(r => [seconds(r.ms), r.ready])),
      terminating: fromZero(terminating),
      done,
      waiting: fromZero(queue.map(q => [seconds(q.ms), q.visible])),
      processing: fromZero(queue.map(q => [seconds(q.ms), q.inflight]))
    },
    numbers: {
      created: jobs.length,
      done: doneJobs.length,
      failed: jobs.filter(job => job.status === 'FAILED').length,
      drainSeconds: doneJobs.length
        ? (Math.max(...doneJobs.map(job => job.updated)) - Math.min(...jobs.map(job => job.created))) / 1000
        : NaN,
      peakReady: Math.max(0, ...replicas.map(r => r.ready)),
      peakTerminating: Math.max(0, ...terminating.map(([, value]) => value)),
      firstScaleUpSeconds: firstScaleUp ? seconds(firstScaleUp.ms) : undefined,
      backToMinSeconds: backToMin ? seconds(backToMin.ms) : undefined,
      uploads: k6Numbers(readJson(outDir, 'k6-uploads.json')),
      listagem: k6Numbers(readJson(outDir, 'k6-listagem.json'))
    },
    hasWorkerLogs: events.some(event => event.text.includes('reduzido'))
  };
}
