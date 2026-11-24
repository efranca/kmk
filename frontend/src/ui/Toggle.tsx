import type { InputHTMLAttributes } from "react";

/** An on/off switch with a label: a real checkbox underneath (role="switch"), the whole row is the tap target. */
export function Toggle({ label, className = "", ...rest }: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <label className={`toggle ${className}`}>
      <span className="toggle__label">{label}</span>
      <input type="checkbox" role="switch" className="toggle__input" {...rest} />
      <span className="toggle__track" aria-hidden="true"><span className="toggle__thumb" /></span>
    </label>
  );
}
