import type { Theme } from "../theme";

interface Props {
  value: Theme;
  onChange: (theme: Theme) => void;
  options: readonly { value: Theme; label: string }[];
  /** The group's accessible name, and the id of the text that describes it. */
  label: string;
  describedBy?: string;
}

/** The three looks as small pictures of the app (a sidebar, a bar and a button), one of which is chosen. */
export function ThemePicker({ value, onChange, options, label, describedBy }: Props) {
  return (
    <div className="theme-picker" role="radiogroup" aria-label={label} aria-describedby={describedBy}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`theme-tile theme-tile--${o.value}`}
          onClick={() => onChange(o.value)}
        >
          <span className="theme-tile__preview" aria-hidden="true">
            <span className="theme-tile__side" />
            <span className="theme-tile__bar" />
            <span className="theme-tile__pill" />
          </span>
          <span className="theme-tile__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
