import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../ui/Dialog";
import { errorMessage } from "../ui/errors";
import { useToast } from "../ui/toastContext";
import { getEvent } from "./api";
import { fromEvent, resyncRepeat, toEventInput } from "./eventForm";
import { useSaveEvent } from "./hooks";
import { addDays, diffDays } from "./scheduleDates";
import { ScopeChoice } from "./ScopeChoice";
import type { EventDetail, Occurrence, Scope } from "./types";

/** Where a dragged or resized event now is. */
export interface MovedSlot {
  date: string;
  start: string;
  end: string;
}

/**
 * Saves an event that was dragged to another time or day, or resized, in the Day/Week grid. A one-off event is saved
 * at once (with an Undo); a repeating one first asks which occurrences ("This event / This and following / All").
 * `dialog` is that question: render it somewhere on the page.
 */
export function useMoveEvent() {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useSaveEvent();
  const [pending, setPending] = useState<{ event: EventDetail; item: Occurrence; slot: MovedSlot } | null>(null);
  const fail = (e: unknown) => toast(errorMessage(e, t), "error");

  async function apply(event: EventDetail, item: Occurrence, slot: MovedSlot, scope: Scope) {
    // an occurrence changed before with "this event only" is moved from where it is now
    const changed = event.exceptions.find((x) => x.original_date === item.original_date && !x.cancelled);
    const before = fromEvent(event, item.date, changed);
    const values = {
      ...before,
      allDay: false,
      date: slot.date,
      startTime: slot.start,
      endTime: slot.end,
      repeat: scope === "this" ? before.repeat : resyncRepeat(before.repeat, item.date, slot.date), // the rule follows the day
    };
    const input = toEventInput(values);
    // "all events" keeps the series' own start unless the day changed: then the whole series moves by as many days
    if (scope === "all") input.start_date = addDays(event.start_date, diffDays(item.date, slot.date));
    await save.mutateAsync({ id: event.id, input, scope, occurrenceDate: scope === "all" ? undefined : item.original_date });
    if (event.recurrence) {
      toast(t("schToastMoved"));
      return;
    }
    const back = toEventInput(before);
    back.start_date = event.start_date;
    toast(t("schToastMoved"), {
      action: {
        label: t("undo"),
        onClick: () => {
          save.mutateAsync({ id: event.id, input: back, scope: "all" }).then(() => toast(t("schToastUpdated")), fail);
        },
      },
    });
  }

  async function move(item: Occurrence, slot: MovedSlot) {
    try {
      const event = await getEvent(item.event_id);
      if (event.recurrence) setPending({ event, item, slot });
      else await apply(event, item, slot, "all");
    } catch (e) {
      fail(e);
    }
  }

  const dialog = pending && (
    <Dialog open title={t("schMoveTitle")} onClose={() => setPending(null)}>
      <ScopeChoice
        mode="edit"
        busy={save.isPending}
        onCancel={() => setPending(null)}
        onChoose={(scope) => {
          apply(pending.event, pending.item, pending.slot, scope).then(() => setPending(null), fail);
        }}
      />
    </Dialog>
  );
  return { move, dialog };
}
