import nodemailer from 'nodemailer';

import { EmailSenderService } from './email-sender.service';

jest.mock('nodemailer');

describe('EmailSenderService', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: '1' });

  beforeEach(() => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  });

  it('should create transport without auth when user is omitted', async () => {
    const service = new EmailSenderService({
      host: 'localhost',
      port: 1025,
      from: '4Frames <no-reply@test.local>'
    });

    await service.send({ to: 'a@b.com', subject: 'Hi', body: '<p>x</p>' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      auth: undefined
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: '4Frames <no-reply@test.local>',
      to: 'a@b.com',
      subject: 'Hi',
      html: '<p>x</p>'
    });
  });
});
