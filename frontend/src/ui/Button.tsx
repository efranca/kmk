import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  busy?: boolean;
  children?: ReactNode;
}

export function Button({ variant = "secondary", icon, busy, children, className, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type ?? "button"}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={["btn", `btn--${variant}`, className].filter(Boolean).join(" ")}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string; // required: icon-only buttons need an accessible name
  variant?: Variant;
}

export function IconButton({ icon, label, variant = "ghost", className, type, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={["btn", "btn--icon", `btn--${variant}`, className].filter(Boolean).join(" ")}
    >
      <Icon name={icon} />
    </button>
  );
}
