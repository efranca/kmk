import { useTranslation } from "react-i18next";

import { AvatarFilter } from "../ui/AvatarFilter";
import type { Person } from "../ui/Avatar";
import { Button, IconButton } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { shiftDate, type ScheduleViewKind } from "./scheduleView";

const VIEWS: readonly ScheduleViewKind[] = ["day", "week", "month", "year"];

interface ScheduleToolbarProps {
  view: ScheduleViewKind;
  date: string;
  /** The picked people's ids (none = everyone). */
  people: number[];
  everyone: Person[];
  /** What the view covers, written out ("Nov 8 – 14", "November 2026"). */
  label: string;
  onView: (view: ScheduleViewKind) => void;
  onDate: (date: string) => void;
  onToday: () => void;
  onPeople: (ids: number[]) => void;
  /** A phone: the week view steps by three days. */
  narrow?: boolean;
  search: string;
  onSearch: (text: string) => void;
  /** Whether the search box is showing (the magnifier in the page header opens it). */
  searchOpen: boolean;
}

/**
 * View switch, previous/next/today, the search box (when opened) and the people faces. On a phone the faces sit to the
 * right of the view switch; on a tablet or desktop the search box is on their left.
 */
export function ScheduleToolbar({ view, date, people, everyone, label, onView, onDate, onToday, onPeople, narrow, search, onSearch, searchOpen }: ScheduleToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="sched-toolbar">
      <Segmented label={t("schViewLabel")} value={view} onChange={onView} options={VIEWS.map((v) => ({ value: v, label: t(`schViews${v[0]!.toUpperCase()}${v.slice(1)}`) }))} />
      <div className="sched-toolbar__nav">
        <Button variant="ghost" onClick={onToday}>{t("schToday")}</Button>
        <IconButton icon="chev-left" label={t("schPrev")} onClick={() => onDate(shiftDate(view, date, -1, narrow))} />
        <IconButton icon="chev-right" label={t("schNext")} onClick={() => onDate(shiftDate(view, date, 1, narrow))} />
        <strong className="sched-toolbar__label" aria-live="polite">{label}</strong>
      </div>
      <div className="sched-toolbar__find">
        {searchOpen && (
          <label className="sched-toolbar__search">
            <span className="visually-hidden">{t("schSearchLabel")}</span>
            <input type="search" value={search} autoFocus placeholder={t("schSearchPlaceholder")} onChange={(e) => onSearch(e.target.value)} />
          </label>
        )}
        <div className="sched-toolbar__who">
          <AvatarFilter
            people={everyone}
            selected={people}
            onChange={onPeople}
            label={t("schWho")}
            everyoneLabel={t("everyone")}
            moreLabel={(count) => t("schWhoMore", { count })}
            max={everyone.length}
            size={narrow ? "sm" : "md"}
          />
        </div>
      </div>
    </div>
  );
}
