/** Lower case without accents, so "cafe" finds "Café". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** True when every word of `query` appears in at least one of `fields` (ignoring case and accents). An empty query matches everything. */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(fields.filter(Boolean).join(" "));
  return words.every((w) => haystack.includes(w));
}
