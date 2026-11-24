import { describe, expect, it } from "vitest";

import { flagEmoji, isPrivateAddress, parseUserAgent, relativeTime } from "./devices";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  safariIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  opera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0",
};

describe("parseUserAgent", () => {
  it.each([
    [UA.chromeWin, "Chrome", "Windows"],
    [UA.edge, "Edge", "Windows"],
    [UA.safariIos, "Safari", "iOS"],
    [UA.firefoxLinux, "Firefox", "Linux"],
    [UA.chromeAndroid, "Chrome", "Android"],
    [UA.safariMac, "Safari", "macOS"],
    [UA.opera, "Opera", "Windows"],
  ])("reads %#", (ua, browser, os) => {
    expect(parseUserAgent(ua)).toEqual({ browser, os });
  });

  it("does not guess from nothing or from garbage", () => {
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
    expect(parseUserAgent("curl/8.0")).toEqual({ browser: null, os: null });
  });
});

describe("flagEmoji", () => {
  it("builds the flag from the country code", () => {
    expect(flagEmoji("CA")).toBe("\u{1F1E8}\u{1F1E6}");
  });
  it("is empty without a valid code", () => {
    expect(flagEmoji(null)).toBe("");
    expect(flagEmoji("CAN")).toBe("");
    expect(flagEmoji("1a")).toBe("");
  });
});

describe("isPrivateAddress", () => {
  it.each(["10.0.0.4", "192.168.1.20", "172.16.5.5", "172.31.0.1", "127.0.0.1", "::1", "fd12:3456::1", "fe80::1"])("%s is local", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "172.32.0.1", "2606:4700::1", null])("%s is not", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  it("says minutes, hours and days in the person's language", () => {
    expect(relativeTime("2026-11-24T11:55:00Z", now, "en")).toBe("5 minutes ago");
    expect(relativeTime("2026-11-24T09:00:00Z", now, "en")).toBe("3 hours ago");
    expect(relativeTime("2026-11-22T12:00:00Z", now, "en")).toBe("2 days ago");
  });
  it("says now for the last minute (and for a clock slightly ahead)", () => {
    expect(relativeTime("2026-11-24T11:59:40Z", now, "en")).toBe("now");
    expect(relativeTime("2026-11-24T12:00:30Z", now, "en")).toBe("now");
  });
});
