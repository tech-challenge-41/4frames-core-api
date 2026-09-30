/**
 * Grava, durante um cenário de carga, o que o gráfico precisa. Chamado por run-scenario.sh, que o encerra
 * criando o arquivo `.stop` na pasta de saída.
 *
 * - replicas.log: `<epoch ms> <réplicas desejadas> <réplicas prontas>` do Deployment do worker, a cada mudança
 *   (kubectl -w, sem polling);
 * - pods-watch.log: `kubectl get pods -w` dos workers, com o horário de cada evento (pods-events.log: o mesmo,
 *   com o epoch em ms, para o gráfico);
 * - queue.csv: mensagens visíveis e em processamento na fila do LocalStack, a cada 2 s.
 *
 * Uso: node tests/load/sampler.mjs <pasta de saída>
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const outDir = process.argv[2];
const namespace = process.env.NAMESPACE ?? '4frames';
const sqsEndpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:4566/';
const queueUrl = process.env.QUEUE_URL ?? 'http://localhost:4566/000000000000/4frames-video-uploads';
const QUEUE_INTERVAL_MS = 2_000;

if (!outDir) {
  console.error('uso: node tests/load/sampler.mjs <pasta de saída>');
  process.exit(1);
}

const stopFile = path.join(outDir, '.stop');
const children = [];

function clock(epochMs) {
  return (
    new Date(epochMs).toLocaleTimeString('pt-BR', { hour12: false }) + '.' + String(epochMs % 1000).padStart(3, '0')
  );
}

/** Roda o kubectl e grava cada linha da saída, já com o horário, em cada arquivo pela sua função. */
function watch(args, formats) {
  const outs = Object.entries(formats).map(([file, format]) => ({
    out: createWriteStream(path.join(outDir, file), { flags: 'a' }),
    format
  }));
  const child = spawn('kubectl', ['-n', namespace, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });

  children.push(child);
  createInterface({ input: child.stdout }).on('line', line => {
    const ms = Date.now();
    outs.forEach(({ out, format }) => out.write(format(ms, line) + '\n'));
  });
}

async function sampleQueue(out) {
  try {
    const response = await fetch(sqsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': 'AmazonSQS.GetQueueAttributes' },
      body: JSON.stringify({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
      })
    });
    const { Attributes: attributes } = await response.json();

    out.write(
      `${Date.now()},${attributes.ApproximateNumberOfMessages},${attributes.ApproximateNumberOfMessagesNotVisible}\n`
    );
  } catch (error) {
    // Uma leitura perdida só deixa um buraco no gráfico: o cenário segue.
    console.error(`fila: ${error.message}`);
  }
}

watch(['get', 'deploy', 'worker', '-w', '-o', 'jsonpath={.spec.replicas} {.status.readyReplicas}{"\\n"}'], {
  'replicas.log': (ms, line) => {
    const [desired, ready] = line.trim().split(/\s+/);

    return `${ms} ${desired || 0} ${ready || 0}`;
  }
});
watch(['get', 'pods', '-l', 'app.kubernetes.io/name=worker', '-w', '--output-watch-events'], {
  // Para ler (e mostrar no vídeo) e para o gráfico contar os pods em encerramento.
  'pods-watch.log': (ms, line) => `${clock(ms)}  ${line}`,
  'pods-events.log': (ms, line) => `${ms} ${line}`
});

const queue = createWriteStream(path.join(outDir, 'queue.csv'), { flags: 'a' });
queue.write('epoch_ms,visiveis,em_processamento\n');

const timer = setInterval(() => {
  if (existsSync(stopFile)) {
    clearInterval(timer);
    children.forEach(child => child.kill());
    queue.end();
    return;
  }

  void sampleQueue(queue);
}, QUEUE_INTERVAL_MS);
