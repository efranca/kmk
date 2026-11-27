import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { SelectField } from "../ui/Field";
import { useClient } from "./hooks";
import { placeText } from "./maps";

/** Which property of the chosen client an Agenda item is for (shown once a client is picked). */
export function PropertyPicker({ clientId, value, onChange }: { clientId: number | null; value: number | null; onChange: (id: number | null) => void }) {
  const { t } = useTranslation();
  const { data } = useClient(clientId ?? 0, clientId !== null);
  const properties = data?.properties ?? [];
  // A property that is not this client's (after the client changed) cannot stay picked.
  useEffect(() => {
    if (value !== null && data && !properties.some((p) => p.id === value)) onChange(null);
  }, [value, data, properties, onChange]);
  if (clientId === null || properties.length === 0) return null;
  return (
    <SelectField label={t("propFieldProperty")} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{t("propNone")}</option>
      {properties.map((p) => <option key={p.id} value={p.id}>{p.name}{placeText(p.address, p.city) ? ` · ${placeText(p.address, p.city)}` : ""}</option>)}
    </SelectField>
  );
}
