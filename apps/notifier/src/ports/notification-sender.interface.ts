export interface NotificationInput {
  to: string;
  subject: string;
  body: string;
}

export interface INotificationSender {
  send(input: NotificationInput): Promise<void>;
}
