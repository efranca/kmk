import { useTranslation } from "react-i18next";

import { SelectField } from "../ui/Field";
import { useClients } from "./hooks";

/** The client a task, Agenda item or document is for (optional). Staff pick among the clients they are scheduled for. */
export function ClientPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { t } = useTranslation();
  const { data: clients = [] } = useClients();
  return (
    <SelectField label={t("clientFieldClient")} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{t("clientNone")}</option>
      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </SelectField>
  );
}
