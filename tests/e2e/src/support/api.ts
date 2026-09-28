import fs from 'node:fs';
import path from 'node:path';

import { config, type Credentials } from './config';

export interface HttpResult<T = any> {
  status: number;
  body: T;
}

export interface CreatedJob {
  jobId: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface JobStatus {
  jobId: string;
  status: string;
  fileName: string;
  failureReason?: string;
  progress?: number;
}

const TERMINAL_STATUSES = ['DONE', 'FAILED', 'EXPIRED'];

async function readBody(response: Response): Promise<any> {
  const text = await response.text();

  return text ? JSON.parse(text) : undefined;
}

/** A API do 4Frames pelo Ingress, com o token de um usuário. */
export class ApiClient {
  private constructor(public readonly token: string) {}

  public static async login({ email, password }: Credentials): Promise<ApiClient> {
    const response = await fetch(`${config.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (response.status !== 201) {
      throw new Error(`Login de ${email} falhou: ${response.status}`);
    }

    return new ApiClient((await readBody(response)).accessToken);
  }

  public async request<T = any>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<HttpResult<T>> {
    const response = await fetch(`${config.apiUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    return { status: response.status, body: await readBody(response) };
  }

  /** POST /videos com o tamanho da fixture: cria o job em UPLOAD_PENDING e devolve a URL de upload. */
  public async createJob(fixture: string, fileName: string): Promise<CreatedJob> {
    const created = await this.request<CreatedJob>('POST', '/videos', {
      fileName,
      fileSize: fs.statSync(path.join(config.fixturesDir, fixture)).size,
      contentType: 'video/mp4'
    });

    if (created.status !== 201) {
      throw new Error(`POST /videos respondeu ${created.status}: ${JSON.stringify(created.body)}`);
    }

    return created.body;
  }

  /** PUT direto no S3 pela URL pré-assinada (os bytes não passam pela API), depois POST /complete. */
  public async uploadAndComplete(job: CreatedJob, fixture: string): Promise<void> {
    // A URL é assinada com o Content-Type: o PUT precisa repetir o mesmo.
    const upload = await fetch(job.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: fs.readFileSync(path.join(config.fixturesDir, fixture))
    });

    if (!upload.ok) {
      throw new Error(`PUT no S3 respondeu ${upload.status}: ${await upload.text()}`);
    }

    const completed = await this.request('POST', `/videos/${job.jobId}/complete`);

    if (completed.status !== 200) {
      throw new Error(`POST /complete respondeu ${completed.status}: ${JSON.stringify(completed.body)}`);
    }
  }

  /** O fluxo do front para um arquivo: criar, enviar ao S3 e confirmar. */
  public async submitVideo(fixture: string, fileName: string): Promise<CreatedJob> {
    const job = await this.createJob(fixture, fileName);
    await this.uploadAndComplete(job, fixture);

    return job;
  }

  /** Consulta GET /videos/:jobId a cada segundo até o job chegar a um estado terminal. */
  public async waitForTerminalStatus(jobId: string, timeoutMs = 4 * 60_000): Promise<JobStatus> {
    const deadline = Date.now() + timeoutMs;
    let last: HttpResult<JobStatus> | undefined;

    while (Date.now() < deadline) {
      last = await this.request<JobStatus>('GET', `/videos/${jobId}`);

      if (last.status === 200 && TERMINAL_STATUSES.includes(last.body.status)) {
        return last.body;
      }

      await new Promise(resolve => setTimeout(resolve, 1_000));
    }

    throw new Error(`O job ${jobId} não terminou a tempo; último status: ${JSON.stringify(last?.body)}`);
  }
}
