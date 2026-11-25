import { useState, type InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "./Icon";

/** A password field with an eye button that shows or hides what was typed. `label` is the field's own name: it is set
 * on the input so that the eye button inside the visible <label> does not become part of that name. */
export function PasswordInput({ label, className, ...input }: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "aria-label">) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <span className="pw">
      <input {...input} className={className} type={shown ? "text" : "password"} aria-label={label} />
      <button type="button" className="pw__eye" aria-label={t(shown ? "hidePassword" : "showPassword")} aria-pressed={shown} onClick={() => setShown((s) => !s)}>
        <Icon name={shown ? "eye-off" : "eye"} size={20} />
      </button>
    </span>
  );
}
