// Phone notifications: team pushes (via Expo's push service) and local
// follow-up reminders for leads. See notify.web.ts for the browser (no-op).
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let channelReady = false;
async function ensureChannel() {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync('default', { name: 'Plot updates', importance: AndroidImportance.DEFAULT });
  channelReady = true;
}

async function permitted(ask: boolean): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!ask || !cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * This phone's Expo push token, or null when pushes aren't possible
 * (simulator, permission denied, or the app isn't linked to an EAS project yet).
 */
export async function getPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    await ensureChannel();
    if (!(await permitted(true))) return null;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

/** Send a notification to other team members' phones. Failures are ignored. */
export async function sendPush(tokens: string[], title: string, body: string, data: Record<string, string> = {}) {
  const to = [...new Set(tokens.filter((t) => t && t.startsWith('ExponentPushToken')))];
  if (!to.length) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(to.map((t) => ({ to: t, title, body, data, sound: null, channelId: 'default' }))),
    });
  } catch {
    // offline: notifications are best effort
  }
}

/** Reminder on this phone at 10:00 on the follow-up date (replaces an earlier one for the same lead). */
export async function scheduleFollowUp(leadId: string, date: string | undefined, title: string, body: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync('lead-' + leadId).catch(() => undefined);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const [y, m, d] = date.split('-').map(Number);
    const when = new Date(y, m - 1, d, 10, 0, 0);
    if (when.getTime() <= Date.now()) return;
    await ensureChannel();
    if (!(await permitted(true))) return;
    await Notifications.scheduleNotificationAsync({
      identifier: 'lead-' + leadId,
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: 'default' },
    });
  } catch {
    // reminders are best effort
  }
}

export async function cancelFollowUp(leadId: string) {
  await Notifications.cancelScheduledNotificationAsync('lead-' + leadId).catch(() => undefined);
}

export const notificationsSupported = true;

/** Called when the user taps a notification (to open the right project). */
export function onNotificationOpen(cb: (data: Record<string, unknown>) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => cb((r.notification.request.content.data || {}) as Record<string, unknown>));
  return () => sub.remove();
}
