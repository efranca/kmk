import type { ButtonHTMLAttributes, ReactNode } from "react";

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { pressed: boolean };

/** One toggle chip: pressed or not (a weekday, a reminder shortcut...). */
export function ChoiceChip({ pressed, className, ...rest }: ChipProps) {
  return <button type="button" aria-pressed={pressed} className={["chip", className].filter(Boolean).join(" ")} {...rest} />;
}

/** A row of chips with a group name for assistive technology. */
export function ChoiceChips({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={["chips", className].filter(Boolean).join(" ")} role="group" aria-label={label}>
      {children}
    </div>
  );
}
