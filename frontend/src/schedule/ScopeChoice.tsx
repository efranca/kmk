import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";
import type { Scope } from "./types";

const LABEL: Record<Scope, string> = { this: "schScopeThis", following: "schScopeFollowing", all: "schScopeAll" };

interface ScopeChoiceProps {
  /** Editing or deleting decides the title and the look of the confirm button. */
  mode: "edit" | "delete";
  busy?: boolean;
  /** Choices that cannot apply (this event only, when something of the whole series changed). */
  hide?: Scope[];
  onChoose: (scope: Scope) => void;
  onCancel: () => void;
}

/** "This event / This and following events / All events": asked before changing or deleting an occurrence of a repeating event. */
export function ScopeChoice({ mode, busy, hide = [], onChoose, onCancel }: ScopeChoiceProps) {
  const { t } = useTranslation();
  const name = useId();
  const options = (["this", "following", "all"] as Scope[]).filter((o) => !hide.includes(o));
  const [scope, setScope] = useState<Scope>(options[0] ?? "all");
  return (
    <div className="sched-scope" role="radiogroup" aria-labelledby={`${name}-title`}>
      <h3 id={`${name}-title`} className="sched-scope__title">{t(mode === "edit" ? "schScopeEditTitle" : "schScopeDeleteTitle")}</h3>
      {hide.length > 0 && <p className="field__hint">{t("schScopeSeriesOnly")}</p>}
      {options.map((o) => (
        <label key={o} className="check">
          <input type="radio" name={name} checked={scope === o} onChange={() => setScope(o)} />
          {t(LABEL[o])}
        </label>
      ))}
      <div className="sched-scope__actions">
        <Button variant="ghost" onClick={onCancel}>{t("cancel")}</Button>
        <Button variant={mode === "delete" ? "danger" : "primary"} busy={busy} onClick={() => onChoose(scope)}>{t("schScopeOk")}</Button>
      </div>
    </div>
  );
}
