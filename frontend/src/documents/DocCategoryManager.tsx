import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../session";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { TextField } from "../ui/Field";
import { IconPicker } from "../ui/IconPicker";
import { DEFAULT_CATEGORY_ICON, FALLBACK_CATEGORY_ICON } from "../tasks/CategoryChips";
import type { DocumentCategory } from "./api";
import { useDeleteDocumentCategory, useDocuments, useSaveDocumentCategory } from "./hooks";

/** Add, rename, re-icon or delete document categories (administrators). Deleting keeps the documents. */
export function DocCategoryManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { data, isPending, isError, error, refetch } = useDocuments();
  const save = useSaveDocumentCategory();
  const remove = useDeleteDocumentCategory();
  const canManage = user.role !== "user";
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_CATEGORY_ICON);
  const [editing, setEditing] = useState<{ id: number; name: string; icon: string } | null>(null);
  const [deleting, setDeleting] = useState<DocumentCategory | null>(null);
  const failure = save.error ?? remove.error;
  const swallow = (p: Promise<unknown>) => void p.catch(() => undefined); // the failure is shown from the mutation's error

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await save.mutateAsync({ input: { name: name.trim(), icon: icon || DEFAULT_CATEGORY_ICON } });
    setName("");
    setIcon(DEFAULT_CATEGORY_ICON);
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editing.name.trim()) return;
    await save.mutateAsync({ id: editing.id, input: { name: editing.name.trim(), icon: editing.icon || DEFAULT_CATEGORY_ICON } });
    setEditing(null);
  }

  return (
    <section className="catmanager" aria-label={t("docCategories")}>
      <div className="catmanager__head">
        <h2>{t("docCategories")}</h2>
        <Button variant="ghost" onClick={onClose}>{t("taskCatBack")}</Button>
      </div>
      {canManage && (
        <form className="catmanager__add" onSubmit={(e) => swallow(add(e))} noValidate>
          <IconPicker value={icon} label={t("schFormIcon")} onChange={setIcon} />
          <TextField label={t("taskCatName")} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" icon="plus" busy={save.isPending && editing === null}>{t("taskCatAdd")}</Button>
        </form>
      )}
      {failure && <ErrorNotice error={failure} />}
      {isPending ? <Loading /> : isError ? <ErrorNotice error={error} onRetry={() => void refetch()} /> : (
        <ul className="catmanager__list">
          {data.categories.map((c) => (
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
          <p>{t("docCatDeleteBody")}</p>
          {remove.error && <ErrorNotice error={remove.error} />}
        </Dialog>
      )}
    </section>
  );
}
