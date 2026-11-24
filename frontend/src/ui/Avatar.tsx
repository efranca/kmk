import type { CSSProperties } from "react";

import { eventColorVar, initials, type EventColor } from "./memberColor";

/** A person as the schedule shows them: the API's `/people` entry. */
export type Person = { id: number; name: string; color: EventColor };

interface AvatarProps {
  person: Person;
  size?: "sm" | "md" | "lg";
  /** A person who can no longer be chosen (disabled or deleted): same face, muted. */
  muted?: boolean;
  /** Decorative when the name is shown next to it (the default); otherwise it announces the name. */
  labelled?: boolean;
}

/** A round face: the person's initials on their color. */
export function Avatar({ person, size = "md", muted = false, labelled = false }: AvatarProps) {
  const style = { "--avatar-color": eventColorVar(person.color) } as CSSProperties;
  const a11y = labelled ? { role: "img", "aria-label": person.name } : { "aria-hidden": true };
  return (
    <span className={`avatar avatar--${size} ${muted ? "avatar--muted" : ""}`} style={style} {...a11y}>
      {initials(person.name)}
    </span>
  );
}
