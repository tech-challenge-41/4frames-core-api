import nodemailer, { type Transporter } from 'nodemailer';

import { type INotificationSender, type NotificationInput } from '@/ports/notification-sender.interface';

export interface EmailSenderConfig {
  host: string;
  port: number;
  from: string;
  user?: string;
  pass?: string;
}

export class EmailSenderService implements INotificationSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: EmailSenderConfig) {
    this.from = config.from;

    const user = config.user?.trim();
    const pass = config.pass?.trim();
    const auth = user && pass ? { user, pass } : undefined;

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      auth
    });
  }

  public async send(input: NotificationInput): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.body
    });
  }
}
