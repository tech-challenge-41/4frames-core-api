import { config } from './config';

export interface Email {
  subject: string;
  to: string[];
  text: string;
}

async function getJson(route: string): Promise<any> {
  const response = await fetch(`${config.mailpitUrl}${route}`);

  if (!response.ok) {
    throw new Error(`Mailpit respondeu ${response.status} em ${route}`);
  }

  return response.json();
}

/** Espera o e-mail que cita o texto (ex.: o jobId, que vai no corpo e no link) chegar ao Mailpit. */
export async function waitForEmail(text: string, timeoutMs = 60_000): Promise<Email> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const search = await getJson(`/api/v1/search?query=${encodeURIComponent(`"${text}"`)}`);
    const [summary] = search.messages ?? [];

    if (summary) {
      const message = await getJson(`/api/v1/message/${summary.ID}`);

      return {
        subject: message.Subject,
        to: message.To.map((recipient: { Address: string }) => recipient.Address),
        text: message.Text
      };
    }

    await new Promise(resolve => setTimeout(resolve, 1_000));
  }

  throw new Error(`Nenhum e-mail com "${text}" chegou ao Mailpit a tempo`);
}
