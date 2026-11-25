import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disablePush, enablePush, pushSupported, urlBase64ToBytes } from "./push";

const calls: { method: string; url: string; body: unknown }[] = [];

function server(key: string | null = "BAUY") {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const json = (status: number, data: unknown) => new Response(status === 204 ? null : JSON.stringify(data), { status });
    if (url === "/api/push/key") return json(200, { key });
    if (init.method === "DELETE") return json(204, {});
    return json(201, { status: "ok" });
  }));
}

function browser(permission: NotificationPermission = "default", granted: NotificationPermission = "granted") {
  const subscription = { endpoint: "https://push.example/1", toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "P", auth: "A" } }), unsubscribe: vi.fn(async () => true) };
  const pushManager = { subscribe: vi.fn(async () => subscription), getSubscription: vi.fn(async () => null as typeof subscription | null) };
  vi.stubGlobal("Notification", { permission, requestPermission: vi.fn(async () => granted) });
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: vi.fn(async () => ({})), ready: Promise.resolve({ pushManager }) } });
  return { pushManager, subscription };
}

beforeEach(() => server());
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("push", () => {
  it("turns a base64url key into bytes", () => {
    expect(Array.from(urlBase64ToBytes("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToBytes("_-8"))).toEqual([255, 239]);
  });

  it("is unsupported where the browser has no push", async () => {
    expect(pushSupported()).toBe(false);
    expect(await enablePush("tok")).toBe("unsupported");
  });

  it("subscribes and sends the subscription to the server", async () => {
    const { pushManager } = browser();
    expect(pushSupported()).toBe(true);
    expect(await enablePush("tok")).toBe("on");
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/push/subscriptions", body: { endpoint: "https://push.example/1", keys: { p256dh: "P", auth: "A" } } });
  });

  it("stops when the person refuses, or the server has no key", async () => {
    const { pushManager } = browser("default", "denied");
    expect(await enablePush("tok")).toBe("denied");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    browser();
    server(null);
    expect(await enablePush("tok")).toBe("no_key");
  });

  it("turns notifications off: the server forgets the device, then the browser does", async () => {
    const { pushManager, subscription } = browser();
    pushManager.getSubscription.mockResolvedValue(subscription);
    await disablePush("tok");
    expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ url: "/api/push/subscriptions", body: { endpoint: "https://push.example/1" } });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});
