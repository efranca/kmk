export const FALLBACK_CATEGORY_ICON = "🏷️";

interface CategoryChipsProps {
  label: string;
  allLabel: string;
  allCount: number;
  options: { id: number; name: string; icon: string | null; count: number }[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}

/** One row of category chips ("All" first), each with its icon and how many tasks it holds; it scrolls sideways when it does not fit. */
export function CategoryChips({ label, allLabel, allCount, options, selected, onSelect }: CategoryChipsProps) {
  return (
    <div className="catchips" role="group" aria-label={label}>
      <button type="button" className="chip" aria-pressed={selected === null} onClick={() => onSelect(null)}>{allLabel} {allCount}</button>
      {options.map((o) => (
        <button key={o.id} type="button" className="chip" aria-pressed={selected === o.id} onClick={() => onSelect(o.id)}>
          {o.icon ?? FALLBACK_CATEGORY_ICON} {o.name} {o.count}
        </button>
      ))}
    </div>
  );
}
