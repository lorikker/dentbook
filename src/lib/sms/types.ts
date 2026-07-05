export interface SmsProvider {
  send(to: string, message: string): Promise<{ providerRef: string }>;
}
