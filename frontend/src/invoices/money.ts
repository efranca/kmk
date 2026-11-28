// Money is a string with two decimals ("195.00") everywhere except on screen; sums are done in whole cents.
const MAX_CENTS = 9_999_999;

function toCents(amount: string): number {
  const [whole, cents = ""] = amount.split(".");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0").slice(0, 2));
}

function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** What people type (`120`, `120,5`, ` 1 234,50 `) as "120.50", or null when empty, negative, over 99999.99 or with more than two decimals. */
export function parseMoney(input: string): string | null {
  const text = input.replace(/[\s ]/g, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(text)) return null;
  const [whole, cents = ""] = text.split(/[.,]/);
  const total = Number(whole) * 100 + Number(cents.padEnd(2, "0"));
  return total > MAX_CENTS ? null : fromCents(total);
}

export function sumMoney(values: string[]): string {
  return fromCents(values.reduce((sum, v) => sum + toCents(v), 0));
}

/** `195.00` as "195,00 $" in French, "CA$195.00" in English. */
export function formatMoney(amount: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(toCents(amount) / 100);
}
