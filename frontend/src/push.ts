// Web Push from the browser's side: register the service worker, ask permission, subscribe, tell the server.
import { request } from "./schedule/api";

export type EnableResult = "on" | "denied" | "unsupported" | "no_key";

/** A VAPID key arrives as base64url text; `subscribe` wants bytes. */
export function urlBase64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = (text + "=".repeat((4 - (text.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

export async function enablePush(csrf: string): Promise<EnableResult> {
  if (!pushSupported()) return "unsupported";
  const { key } = await request<{ key: string | null }>("GET", "/api/push/key");
  if (!key) return "no_key";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return "denied";
  const subscription = (await registration()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) });
  const { endpoint, keys } = (await subscription).toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await request("POST", "/api/push/subscriptions", csrf, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  return "on";
}

export async function disablePush(csrf: string): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await request("DELETE", "/api/push/subscriptions", csrf, { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

export async function testPush(csrf: string): Promise<number> {
  return (await request<{ sent: number }>("POST", "/api/push/test", csrf)).sent;
}
