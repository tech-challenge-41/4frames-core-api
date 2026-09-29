import { randomUUID } from 'node:crypto';

import AdmZip from 'adm-zip';

import { ApiClient, type CreatedJob } from './support/api';
import { config } from './support/config';
import { waitForEmail } from './support/mailpit';
import { openJobEvents } from './support/sse';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Prefixo dos arquivos desta execução, para achá-los na listagem e no Mailpit. */
const RUN_ID = `e2e-${Date.now()}`;

function timeout(ms: number, what: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: tempo esgotado`)), ms).unref());
}

describe('4Frames ponta a ponta, pelo Ingress do cluster', () => {
  let api: ApiClient;
  let validJob: CreatedJob;
  let invalidJob: CreatedJob;

  beforeAll(async () => {
    api = await ApiClient.login(config.user);
  });

  it('should convert a valid video, with the progress arriving over SSE until job.done', async () => {
    validJob = await api.createJob(config.validVideo, `${RUN_ID}-valido.mp4`);

    // O stream abre antes do upload, como a tela do job, e recebe todo o processamento.
    const stream = await openJobEvents(validJob.jobId, api.token);
    expect(stream.status).toBe(200);
    expect(stream.contentType).toBe('text/event-stream');

    await api.uploadAndComplete(validJob, config.validVideo);
    await Promise.race([stream.ended, timeout(4 * 60_000, 'SSE até o job.done')]);

    const progress = stream.events.filter(event => event.type === 'job.progress').map(event => event.percent!);
    expect(progress.length).toBeGreaterThan(0);
    expect(
      progress.every((percent, index) => percent >= 0 && percent <= 100 && percent >= (progress[index - 1] ?? 0))
    ).toBe(true);
    expect(stream.events.at(-1)).toMatchObject({
      type: 'job.done',
      jobId: validJob.jobId,
      frameCount: config.validVideoFrames
    });

    // O status no Postgres é a fonte da verdade; o SSE só traz o percentual.
    expect(await api.waitForTerminalStatus(validJob.jobId)).toMatchObject({ status: 'DONE' });
  });

  it('should download a zip with one PNG per second at its root, in order', async () => {
    const download = await api.request('GET', `/videos/${validJob.jobId}/download`);
    expect(download.status).toBe(200);

    const zipResponse = await fetch(download.body.downloadUrl);
    expect(zipResponse.status).toBe(200);

    const entries = new AdmZip(Buffer.from(await zipResponse.arrayBuffer())).getEntries();
    const expectedNames = Array.from(
      { length: config.validVideoFrames },
      (_, index) => `frame_${String(index + 1).padStart(4, '0')}.png`
    );

    expect(entries.map(entry => entry.entryName)).toEqual(expectedNames);
    expect(entries.every(entry => entry.getData().subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))).toBe(true);
  });

  it('should e-mail the owner with the link to the job', async () => {
    const email = await waitForEmail(validJob.jobId);

    expect(email.to).toEqual([config.user.email]);
    expect(email.subject).toBe('4Frames — Seu vídeo foi convertido');
    expect(email.text).toContain(`/jobs/${validJob.jobId}`);
    expect(email.text).toContain(`${config.validVideoFrames} frame(s)`);
  });

  it('should mark an invalid file as FAILED with the reason, and e-mail the failure', async () => {
    invalidJob = await api.submitVideo(config.invalidVideo, `${RUN_ID}-invalido.mp4`);

    const status = await api.waitForTerminalStatus(invalidJob.jobId);
    expect(status.status).toBe('FAILED');
    expect(status.failureReason).toEqual(expect.any(String));

    const email = await waitForEmail(invalidJob.jobId);
    expect(email.to).toEqual([config.user.email]);
    expect(email.subject).toBe('4Frames — Falha na conversão do vídeo');
    expect(email.text).toContain(status.failureReason);
  });

  it('should list both jobs with their final status', async () => {
    const list = await api.request('GET', '/videos?limit=100');
    expect(list.status).toBe(200);

    const byId = new Map(list.body.items.map((item: { jobId: string }) => [item.jobId, item]));

    expect(byId.get(validJob.jobId)).toMatchObject({ status: 'DONE', hasDownload: true });
    expect(byId.get(invalidJob.jobId)).toMatchObject({ status: 'FAILED', failureReason: expect.any(String) });
  });

  it('should answer 404 to another user, the same as for a job that does not exist', async () => {
    const other = await ApiClient.login(config.otherUser);

    const notMine = await other.request('GET', `/videos/${validJob.jobId}`);
    const unknown = await other.request('GET', `/videos/${randomUUID()}`);
    const download = await other.request('GET', `/videos/${validJob.jobId}/download`);

    expect(notMine.status).toBe(404);
    expect(download.status).toBe(404);
    expect(notMine.body).toEqual(unknown.body);
  });
});
