/** Small, pure helpers for the Devices page. */

export function parseUserAgent(ua: string | null): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /Windows NT/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux|X11/.test(ua)
              ? "Linux"
              : null;
  return { browser, os };
}

/** The flag emoji for a two-letter country code (Windows draws the letters instead), or "". */
export function flagEmoji(country: string | null): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return "";
  return [...country.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

/** True for loopback, private and link-local addresses (no location to show). */
export function isPrivateAddress(ip: string | null): boolean {
  if (!ip) return false;
  if (ip === "::1" || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function relativeTime(iso: string, now: Date, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

/** A phone (Android, iOS) or a computer (everything else, and when the system is unknown): picks the device's icon. */
export function deviceKind(os: string | null): "phone" | "computer" {
  return os === "Android" || os === "iOS" ? "phone" : "computer";
}

/** Seen in the last five minutes (the app pings while it is open, so this means someone is using it now). */
export function isActiveNow(lastSeenIso: string, now: Date): boolean {
  return now.getTime() - new Date(lastSeenIso).getTime() < 5 * 60_000;
}
