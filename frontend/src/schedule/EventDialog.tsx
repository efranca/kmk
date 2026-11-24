import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../session";
import { AvatarFilter } from "../ui/AvatarFilter";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { TextAreaField, TextField } from "../ui/Field";
import { IconPicker } from "../ui/IconPicker";
import { EVENT_COLORS, eventColorVar } from "../ui/memberColor";
import { useToast } from "../ui/toastContext";
import {
  EVENT_TITLE_MAX, emptyEventForm, fromEvent, resyncRepeat, seriesFieldsChanged, toEventInput, validateEventForm,
  type EventFormErrors, type EventFormValues,
} from "./eventForm";
import { useDeleteEvent, useEvent, usePeople, useSaveEvent } from "./hooks";
import { canChangeEvent } from "./permissions";
import { RecurrenceFields } from "./RecurrenceFields";
import { ReminderFields } from "./ReminderFields";
import { addDays, diffDays } from "./scheduleDates";
import { ScopeChoice } from "./ScopeChoice";
import type { EventDetail, Occurrence, Scope } from "./types";
import { useNarrow } from "./useNarrow";

/** What the dialog is for: a new event (on a day, optionally at a minute of it), or the event behind an occurrence. */
export type EventDialogTarget = { kind: "new"; date: string; minutes?: number } | { kind: "item"; item: Occurrence };

interface EventDialogProps {
  target: EventDialogTarget;
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const colorKey = (c: string) => `schColors${c[0]!.toUpperCase()}${c.slice(1)}`;

export function EventDialog({ target, onClose }: EventDialogProps) {
  const { t } = useTranslation();
  if (target.kind === "new") {
    return <EventForm event={null} date={target.date} time={target.minutes === undefined ? undefined : timeOf(target.minutes)} onClose={onClose} />;
  }
  return <LoadedEvent item={target.item} onClose={onClose} title={t("schFormEditTitle")} />;
}

/** Fetches the whole event behind an occurrence; the form mounts once it is here. */
function LoadedEvent({ item, onClose, title }: { item: Occurrence; onClose: () => void; title: string }) {
  const event = useEvent(item.event_id);
  if (event.data) return <EventForm event={event.data} item={item} date={item.date} onClose={onClose} />;
  return (
    <Dialog open title={title} onClose={onClose}>
      {event.isError ? <ErrorNotice error={event.error} onRetry={() => void event.refetch()} /> : <Loading />}
    </Dialog>
  );
}

interface EventFormProps {
  event: EventDetail | null;
  /** The occurrence that was opened (existing events only). */
  item?: Occurrence;
  date: string;
  time?: string;
  onClose: () => void;
}

function EventForm({ event, item, date, time, onClose }: EventFormProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const toast = useToast();
  const group = useId();
  const { user } = useSession();
  const { data: people = [] } = usePeople();
  const narrow = useNarrow();
  const [values, setValues] = useState<EventFormValues>(() => {
    if (!event) return emptyEventForm(date, time);
    // an occurrence changed with "this event only" is reopened as it is now
    const changed = event.exceptions.find((x) => x.original_date === item?.original_date && !x.cancelled);
    return fromEvent(event, date, changed);
  });
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [asking, setAsking] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveEvent();
  const remove = useDeleteEvent();
  const repeating = event?.recurrence != null;
  const editable = event === null || canChangeEvent(user, event);
  const failure = save.error ?? remove.error;
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => setValues({ ...values, [key]: value });
  // the date and the repeat rule move together: a rule that followed the old date follows the new one
  const setDate = (next: string) => setValues({ ...values, date: next, repeat: resyncRepeat(values.repeat, values.date, next) });

  async function persist(scope: Scope) {
    const input = toEventInput(values);
    if (!event || !item) {
      await save.mutateAsync({ input });
      toast(t("schToastCreated"));
    } else {
      // "all events" keeps the series' own start unless the date was moved: then the whole series moves by as many days
      if (scope === "all") input.start_date = addDays(event.start_date, diffDays(item.date, values.date));
      await save.mutateAsync({ id: event.id, input, scope, occurrenceDate: scope === "all" ? undefined : item.original_date });
      toast(t("schToastUpdated"));
    }
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateEventForm(values, { requireDateInRule: !event });
    setErrors(found);
    if (Object.keys(found).length) return;
    if (repeating) setAsking("save");
    else await persist("all");
  }

  async function doDelete(scope: Scope) {
    if (!event || !item) return;
    await remove.mutateAsync({ id: event.id, scope, occurrenceDate: scope === "all" ? undefined : item.original_date });
    toast(t("schToastDeleted"));
    onClose();
  }

  const formId = `${group}-form`;
  const swallow = (p: Promise<unknown>) => void p.catch(() => undefined); // the failure is shown from the mutation's error
  const title = event ? t("schFormEditTitle") : t("schFormNewTitle");

  const footer = asking ? undefined : !editable ? (
    <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
  ) : confirmDelete ? (
    <>
      <p className="dialog__question">{t("schFormDeleteQuestion")}</p>
      <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t("cancel")}</Button>
      <Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => swallow(doDelete("all"))}>{t("delete")}</Button>
    </>
  ) : (
    <>
      {event && (
        <Button variant="danger" icon="trash" className="dialog__left" onClick={() => (repeating ? setAsking("delete") : setConfirmDelete(true))}>{t("delete")}</Button>
      )}
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button variant="primary" type="submit" form={formId} busy={save.isPending}>{t("save")}</Button>
    </>
  );

  return (
    <Dialog open title={title} onClose={onClose} footer={footer}>
      {asking && (
        <ScopeChoice
          mode={asking === "save" ? "edit" : "delete"}
          hide={asking === "save" && event && seriesFieldsChanged(event, values) ? ["this"] : []}
          busy={save.isPending || remove.isPending}
          onCancel={() => setAsking(null)}
          onChoose={(scope) => swallow(asking === "save" ? persist(scope) : doDelete(scope))}
        />
      )}
      {!editable && <p className="notice" role="note">{t("schViewOnly")}</p>}
      <form id={formId} hidden={asking !== null} onSubmit={(e) => swallow(submit(e))} noValidate>
        <fieldset className="sched-form" disabled={!editable}>
          <div className="sched-form__title">
            <IconPicker value={values.icon} label={t("schFormIcon")} onChange={(icon) => set("icon", icon)} />
            <TextField
              label={t("schFormTitle")}
              value={values.title}
              autoFocus={!event}
              maxLength={EVENT_TITLE_MAX + 20}
              error={errors.title && t(errors.title)}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>

          <label className="check">
            <input type="checkbox" checked={values.allDay} onChange={(e) => set("allDay", e.target.checked)} />
            {t("schAllDay")}
          </label>
          <div className="sched-form__when">
            <TextField type="date" label={t("schFormDate")} value={values.date} error={errors.date && t(errors.date)} onChange={(e) => setDate(e.target.value)} />
            {!values.allDay && (
              <>
                <TextField type="time" label={t("schFormStartTime")} value={values.startTime} error={errors.startTime && t(errors.startTime)} onChange={(e) => set("startTime", e.target.value)} />
                <TextField type="time" label={`${t("schFormEndTime")} (${t("optional")})`} value={values.endTime} error={errors.endTime && t(errors.endTime)} onChange={(e) => set("endTime", e.target.value)} />
              </>
            )}
          </div>

          <div className="field">
            <span className="field__label">{t("schFormPeople")}</span>
            <AvatarFilter
              people={people}
              selected={values.people}
              onChange={(ids) => set("people", ids)}
              label={t("schFormPeople")}
              everyoneLabel={t("everyone")}
              moreLabel={(count) => t("schWhoMore", { count })}
              max={narrow ? 3 : 5}
              showNames
              disabled={!editable}
            />
            <p className="field__hint">{t("schFormPeopleHint")}</p>
          </div>

          <RecurrenceFields values={values} errors={errors} locale={locale} onChange={(repeat) => set("repeat", repeat)} />
          <ReminderFields values={values.reminders} error={errors.reminders && t(errors.reminders)} onChange={(r) => set("reminders", r)} />

          <div className="field">
            <span className="field__label" id={`${group}-color`}>{t("schFormColor")}</span>
            <div className="sched-colors" role="radiogroup" aria-labelledby={`${group}-color`}>
              <button type="button" role="radio" aria-checked={values.color === ""} className="sched-colors__auto" onClick={() => set("color", "")}>{t("schFormColorAuto")}</button>
              {EVENT_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={values.color === c} aria-label={t(colorKey(c))} className="sched-colors__swatch" style={{ background: eventColorVar(c) }} onClick={() => set("color", c)} />
              ))}
            </div>
          </div>

          <TextAreaField label={`${t("schFormNotes")} (${t("optional")})`} rows={2} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
        </fieldset>
      </form>
      {failure && <ErrorNotice error={failure} />}
    </Dialog>
  );
}
