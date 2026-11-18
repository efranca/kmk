/** The name to show for a person: their name when they have one, otherwise their username. */
export function displayName(p: { name?: string | null; username: string }): string {
  return p.name && p.name.trim() ? p.name : p.username;
}

/** Accents removed, capitals folded, spaces collapsed: for searching ("Élise" matches "elise"). */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
