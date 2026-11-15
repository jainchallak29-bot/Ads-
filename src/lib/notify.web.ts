// Browsers: no push notifications or scheduled reminders.
export async function getPushToken(): Promise<string | null> {
  return null;
}
export async function sendPush(_tokens: string[], _title: string, _body: string, _data: Record<string, string> = {}) {}
export async function scheduleFollowUp(_leadId: string, _date: string | undefined, _title: string, _body: string) {}
export async function cancelFollowUp(_leadId: string) {}
export const notificationsSupported = false;
export function onNotificationOpen(_cb: (data: Record<string, unknown>) => void): () => void {
  return () => undefined;
}
