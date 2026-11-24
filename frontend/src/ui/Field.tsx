import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label + control + hint + error, wired together for screen readers (aria-describedby / aria-invalid). */
export function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">{label}</label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && <p id={`${id}-hint`} className="field__hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="field__error" role="alert">{error}</p>}
    </div>
  );
}

type Shared = { label: string; hint?: string; error?: string | null };

export function TextField({ label, hint, error, ...input }: Shared & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input id={id} className="input" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...input} />
      )}
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, error, ...input }: Shared & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} className="input input--area" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...input} />
      )}
    </FieldShell>
  );
}

export function SelectField({ label, hint, error, children, ...select }: Shared & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="input input--select" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...select}>
          {children}
        </select>
      )}
    </FieldShell>
  );
}
