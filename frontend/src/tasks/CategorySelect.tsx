import { useTranslation } from "react-i18next";

import { SelectField } from "../ui/Field";
import { FALLBACK_CATEGORY_ICON } from "./CategoryChips";
import { useCategories } from "./hooks";

/** The category of a task: "No category", or one of the categories with its icon (a generic one when it has none). */
export function CategorySelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { t } = useTranslation();
  const { data: categories = [] } = useCategories();
  return (
    <SelectField label={t("taskFieldCategory")} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{t("taskNoCategory")}</option>
      {categories.map((c) => <option key={c.id} value={c.id}>{c.icon ?? FALLBACK_CATEGORY_ICON} {c.name}</option>)}
    </SelectField>
  );
}
