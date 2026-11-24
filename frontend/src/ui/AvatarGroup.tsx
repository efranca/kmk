import { useTranslation } from "react-i18next";

import { Avatar, type Person } from "./Avatar";
import { Icon } from "./Icon";

/** "Everyone" as a face: the people icon in a round avatar (for an event that is for the whole company). */
export function EveryoneAvatar({ size = "sm", label }: { size?: "sm" | "md"; label?: string }) {
  const { t } = useTranslation();
  const name = label ?? t("everyone");
  return (
    <span className={`avatar avatar--${size} avatar--everyone`} role="img" aria-label={name} title={name}>
      <Icon name="family" size={size === "sm" ? 14 : 22} />
    </span>
  );
}

/** A few faces that overlap a little. Up to `max` show; the rest are one "+N" (their names on hover). */
export function AvatarGroup({
  people,
  everyone,
  max = 4,
  size = "sm",
  mutedIds,
}: {
  people: Person[];
  everyone: boolean;
  max?: number;
  size?: "sm" | "md";
  mutedIds?: ReadonlySet<number>;
}) {
  if (everyone) return <EveryoneAvatar size={size} />;
  const shown = people.slice(0, max);
  const rest = people.slice(max);
  return (
    <span className={`avatargroup avatargroup--${size}`}>
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} labelled muted={mutedIds?.has(p.id)} />
      ))}
      {rest.length > 0 && (
        <span className="avatarmore" role="img" title={rest.map((p) => p.name).join(", ")} aria-label={rest.map((p) => p.name).join(", ")}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}
