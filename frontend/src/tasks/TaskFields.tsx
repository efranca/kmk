import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { usePeople } from "../schedule/hooks";
import { COMPANY_TIME_ZONE, addDays, todayIn } from "../schedule/scheduleDates";
import { useNarrow } from "../schedule/useNarrow";
import { AvatarFilter } from "../ui/AvatarFilter";
import { ChoiceChip, ChoiceChips } from "../ui/ChoiceChips";
import { TextAreaField, TextField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { IconPicker } from "../ui/IconPicker";
import { ClientPicker } from "../clients/ClientPicker";
import { CategorySelect } from "./CategorySelect";
import { DESCRIPTION_MAX, TITLE_MAX, type TaskFormErrors, type TaskFormValues } from "./taskForm";
import { suggestIcon } from "./suggestIcon";

interface TaskFieldsProps {
  values: TaskFormValues;
  errors: TaskFormErrors;
  onChange: (values: TaskFormValues) => void;
  autoFocus?: boolean;
  /** A new task: the icon follows the title ("Mop the floor" → 🧹) until one is picked by hand. */
  autoIcon?: boolean;
  /** Staff: a task is for themselves, so the people cannot be changed. */
  peopleLocked?: boolean;
  /** Staff adding a task: it is for them, so the field is not shown at all. */
  peopleHidden?: boolean;
}

/** The fields of a task, shared by every way of editing one. */
export function TaskFields({ values, errors, onChange, autoFocus, autoIcon, peopleLocked, peopleHidden }: TaskFieldsProps) {
  const { t } = useTranslation();
  const group = useId();
  const narrow = useNarrow();
  const { data: people = [] } = usePeople();
  const [picking, setPicking] = useState(false);
  const [iconPicked, setIconPicked] = useState(false);
  const today = todayIn(COMPANY_TIME_ZONE);
  const tomorrow = addDays(today, 1);
  // the date box shows while "Pick a date" is on, or when the task already has a date that is not today or tomorrow
  const showDate = picking || (values.dueDate !== "" && values.dueDate !== today && values.dueDate !== tomorrow);
  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => onChange({ ...values, [key]: value });

  return (
    <div className="task-fields">
      <div className="task-fields__title">
        <IconPicker value={values.icon} label={t("schFormIcon")} onChange={(icon) => { setIconPicked(true); set("icon", icon); }} />
        <TextField
          label={t("taskFieldTitle")}
          value={values.title}
          autoFocus={autoFocus}
          maxLength={TITLE_MAX + 20}
          error={errors.title && t(errors.title)}
          onChange={(e) => {
            const title = e.target.value;
            onChange({ ...values, title, icon: autoIcon && !iconPicked ? suggestIcon(title) : values.icon });
          }}
        />
      </div>

      {!peopleHidden && <div className="field">
        <span className="field__label">{t("taskFieldPeople")}</span>
        <AvatarFilter
          people={people.filter((p) => p.active !== false || values.people.includes(p.id))}
          selected={values.people}
          onChange={(ids) => set("people", ids)}
          label={t("taskFieldPeople")}
          everyoneLabel={t("everyone")}
          moreLabel={(count) => t("schWhoMore", { count })}
          max={narrow ? 3 : 5}
          showNames
          disabled={peopleLocked}
        />
        {!peopleLocked && <p className="field__hint">{t("taskFieldPeopleHint")}</p>}
      </div>}

      <div className="field">
        <span className="field__label" id={`${group}-due`}>{t("taskFieldDue")} ({t("optional")})</span>
        <ChoiceChips label={t("taskFieldDue")}>
          {([["taskDueToday", today], ["taskDueTomorrow", tomorrow]] as const).map(([key, date]) => (
            <ChoiceChip key={key} pressed={values.dueDate === date} onClick={() => { setPicking(false); set("dueDate", values.dueDate === date ? "" : date); }}>
              {t(key)}
            </ChoiceChip>
          ))}
          <ChoiceChip pressed={showDate} onClick={() => { if (showDate) { setPicking(false); set("dueDate", ""); } else setPicking(true); }}>
            <Icon name="calendar" size={14} /> {t("taskPickDate")}
          </ChoiceChip>
        </ChoiceChips>
        {showDate && <input type="date" className="input" aria-label={t("taskFieldDue")} value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} />}
      </div>

      <CategorySelect value={values.categoryId} onChange={(id) => set("categoryId", id)} />
      <ClientPicker value={values.clientId} onChange={(id) => set("clientId", id)} />

      <TextAreaField
        label={`${t("taskFieldDescription")} (${t("optional")})`}
        rows={2}
        value={values.description}
        maxLength={DESCRIPTION_MAX + 100}
        error={errors.description && t(errors.description)}
        onChange={(e) => set("description", e.target.value)}
      />

      <label className="check">
        <input type="checkbox" checked={values.showOnDashboard} onChange={(e) => set("showOnDashboard", e.target.checked)} />
        {t("taskShowOnDashboard")}
      </label>
    </div>
  );
}
