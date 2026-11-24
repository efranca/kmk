import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../session";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { TextField } from "../ui/Field";
import { IconPicker } from "../ui/IconPicker";
import { FALLBACK_CATEGORY_ICON } from "./CategoryChips";
import { useCategories, useDeleteCategory, useSaveCategory } from "./hooks";
import { canManageCategories } from "./permissions";
import { suggestIcon } from "./suggestIcon";
import type { Category } from "./types";

/** Add a category (anyone); rename it, change its icon or delete it (administrators). Deleting keeps the tasks. */
export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { data: categories, isPending, isError, error, refetch } = useCategories();
  const save = useSaveCategory();
  const remove = useDeleteCategory();
  const canManage = canManageCategories(user);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [iconPicked, setIconPicked] = useState(false);
  const [editing, setEditing] = useState<{ id: number; name: string; icon: string } | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const failure = save.error ?? remove.error;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await save.mutateAsync({ input: { name: name.trim(), icon: icon || null } });
    setName("");
    setIcon("");
    setIconPicked(false);
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editing.name.trim()) return;
    await save.mutateAsync({ id: editing.id, input: { name: editing.name.trim(), icon: editing.icon || null } });
    setEditing(null);
  }

  const swallow = (p: Promise<unknown>) => void p.catch(() => undefined); // the failure is shown from the mutation's error

  return (
    <section className="catmanager" aria-label={t("taskCategories")}>
      <div className="catmanager__head">
        <h2>{t("taskCategories")}</h2>
        <Button variant="ghost" onClick={onClose}>{t("taskCatBack")}</Button>
      </div>
      <form className="catmanager__add" onSubmit={(e) => swallow(add(e))} noValidate>
        <IconPicker value={icon} label={t("schFormIcon")} onChange={(next) => { setIconPicked(true); setIcon(next); }} />
        <TextField label={t("taskCatName")} value={name} maxLength={50}
          onChange={(e) => { setName(e.target.value); if (!iconPicked) setIcon(suggestIcon(e.target.value)); }} />
        <Button type="submit" variant="primary" icon="plus" busy={save.isPending && editing === null}>{t("taskCatAdd")}</Button>
      </form>
      {failure && <ErrorNotice error={failure} />}
      {isPending ? <Loading /> : isError ? <ErrorNotice error={error} onRetry={() => void refetch()} /> : (
        <ul className="catmanager__list">
          {categories.map((c) => (
            <li key={c.id} aria-label={c.name} className="catmanager__row">
              {editing?.id === c.id ? (
                <form className="catmanager__edit" onSubmit={(e) => swallow(rename(e))} noValidate>
                  <IconPicker value={editing.icon} label={t("schFormIcon")} onChange={(next) => setEditing({ ...editing, icon: next })} />
                  <TextField label={t("taskCatName")} value={editing.name} maxLength={50} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <Button variant="ghost" onClick={() => setEditing(null)}>{t("cancel")}</Button>
                  <Button type="submit" variant="primary" busy={save.isPending}>{t("save")}</Button>
                </form>
              ) : (
                <>
                  <span className="catmanager__icon" aria-hidden="true">{c.icon ?? FALLBACK_CATEGORY_ICON}</span>
                  <span className="catmanager__name">{c.name}</span>
                  {canManage && (
                    <>
                      <IconButton icon="pencil" label={t("taskCatEdit", { name: c.name })} onClick={() => { save.reset(); setEditing({ id: c.id, name: c.name, icon: c.icon ?? "" }); }} />
                      <IconButton icon="trash" label={t("taskCatDeleteNamed", { name: c.name })} onClick={() => { remove.reset(); setDeleting(c); }} />
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <Dialog open title={t("taskCatDeleteTitle", { name: deleting.name })} onClose={() => setDeleting(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{t("cancel")}</Button>
            <Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => swallow(remove.mutateAsync(deleting.id).then(() => setDeleting(null)))}>{t("delete")}</Button>
          </>}>
          <p>{t("taskCatDeleteBody")}</p>
          {remove.error && <ErrorNotice error={remove.error} />}
        </Dialog>
      )}
    </section>
  );
}
