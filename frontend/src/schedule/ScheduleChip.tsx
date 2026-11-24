import type { CSSProperties } from "react";

import { eventColorVar } from "../ui/memberColor";
import type { Occurrence } from "./types";

/** A short one-line item for the all-day strip and the month grid. */
export function ScheduleChip({ item, onOpen }: { item: Occurrence; onOpen: (item: Occurrence) => void }) {
  return (
    <button
      type="button"
      title={item.start_time ? `${item.start_time} ${item.title}` : item.title}
      className="grid__chip"
      style={{ "--ev": eventColorVar(item.color) } as CSSProperties}
      onClick={() => onOpen(item)}
    >
      {item.icon && <span aria-hidden="true">{item.icon}</span>}
      <span>{item.title}</span>
    </button>
  );
}
