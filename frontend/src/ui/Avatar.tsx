import { useState, type CSSProperties } from "react";

import { eventColorVar, initials, type EventColor } from "./memberColor";

/** A person as the schedule shows them: the API's `/people` entry. */
export type Person = { id: number; name: string; color: EventColor; /** false for a disabled or deleted account (shown muted, never offered for new events). */ active?: boolean; /** Their picture, when they have set one. */ avatar_url?: string | null };

interface AvatarProps {
  person: Person;
  size?: "sm" | "md" | "lg" | "xl";
  /** A person who can no longer be chosen (disabled or deleted): same face, muted. */
  muted?: boolean;
  /** Decorative when the name is shown next to it (the default); otherwise it announces the name. */
  labelled?: boolean;
}

/** A round face: their picture, or their initials on their color. */
export function Avatar({ person, size = "md", muted = false, labelled = false }: AvatarProps) {
  const style = { "--avatar-color": eventColorVar(person.color) } as CSSProperties;
  const a11y = labelled ? { role: "img", "aria-label": person.name } : { "aria-hidden": true };
  const [broken, setBroken] = useState<string | null>(null);
  const picture = person.avatar_url && broken !== person.avatar_url ? person.avatar_url : null;
  return (
    <span className={`avatar avatar--${size} ${muted ? "avatar--muted" : ""} ${picture ? "avatar--photo" : ""}`} style={style} {...a11y}>
      {picture ? <img src={picture} alt="" className="avatar__img" onError={() => setBroken(picture)} /> : initials(person.name)}
    </span>
  );
}
