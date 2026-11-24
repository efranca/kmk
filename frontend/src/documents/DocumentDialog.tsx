import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { SelectField, TextAreaField, TextField } from "../ui/Field";
import { FALLBACK_CATEGORY_ICON } from "../tasks/CategoryChips";
import { fileUrl, previewUrl, type DocumentCategory, type DocumentItem, type Visibility } from "./api";
import { useDeleteDocument, useSaveDocument } from "./hooks";
import { fileKind } from "./fileKind";
import { DOCUMENT_ACCEPT, formatSize, levelsFor, prepareDocument } from "./prepareDocument";

const LEVEL_KEYS = { everyone: "docLevelEveryone", admins: "docLevelAdmins", superadmin: "docLevelSuperadmin" } as const;

/** One document: its details and file (everyone who can see it), and for administrators the form to add, change, replace or delete. */
export function DocumentDialog({ document, categories, onClose }: { document: DocumentItem | null; categories: DocumentCategory[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const canManage = user.role !== "user";
  const levels = levelsFor(user.role);
  const fileId = useId();
  const save = useSaveDocument();
  const remove = useDeleteDocument();
  const [title, setTitle] = useState(document?.title ?? "");
  const [note, setNote] = useState(document?.note ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(document?.category_id ?? null);
  const [visibility, setVisibility] = useState<Visibility>(document?.visibility ?? "admins");
  const [chosen, setChosen] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const category = categories.find((c) => c.id === document?.category_id);
  const failure = save.error ?? remove.error;

  async function choose(file: File | undefined) {
    setFileError(null);
    if (!file) return setChosen(null);
    try {
      const prepared = await prepareDocument(file);
      setChosen(prepared);
      if (!title.trim()) setTitle(prepared.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setChosen(null);
      setFileError(t(`err_${(e as Error).message}`));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || (!document && !chosen)) return;
    setProgress(chosen ? 0 : null);
    try {
      await save.mutateAsync({
        id: document?.id,
        input: { title: title.trim(), note: note.trim() || null, category_id: categoryId, visibility },
        file: chosen ? { blob: chosen, name: chosen.name } : undefined,
        onProgress: setProgress,
      });
      onClose();
    } catch {
      setProgress(null); // the failure is shown from the mutation's error
    }
  }

  const missingFile = !document && !chosen;
  const footer = canManage ? (
    <>
      {document && !confirmDelete && <Button variant="ghost" icon="trash" onClick={() => { remove.reset(); setConfirmDelete(true); }}>{t("delete")}</Button>}
      {confirmDelete && document && (
        <Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => void remove.mutateAsync(document.id).then(onClose).catch(() => undefined)}>{t("docDeleteConfirm")}</Button>
      )}
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form="doc-form" variant="primary" busy={save.isPending} disabled={!title.trim() || missingFile}>{t("save")}</Button>
    </>
  ) : <Button variant="ghost" onClick={onClose}>{t("close")}</Button>;

  return (
    <Dialog open title={document ? (canManage ? t("docEditTitle") : document.title) : t("docNewTitle")} onClose={onClose} footer={footer}>
      {document?.has_preview && <img className="doc-preview" src={previewUrl(document.id, document.updated_at)} alt="" loading="lazy" />}
      {document?.has_file && (
        <p className="doc-links">
          {fileKind(document.content_type, document.file_name).inline && (
            <><a className="btn btn--secondary" href={fileUrl(document.id)} target="_blank" rel="noopener noreferrer">{t("docOpen")}</a>{" "}</>
          )}
          <a className="btn btn--secondary" href={fileUrl(document.id, true)}>{t("docDownload")}</a>
          <span className="muted"> {document.file_name} · {formatSize(document.size_bytes ?? 0)}</span>
        </p>
      )}
      {canManage ? (
        <form id="doc-form" className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
          <TextField label={t("docFieldTitle")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          <SelectField label={t("docFieldCategory")} value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t("docNoCategory")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon ?? FALLBACK_CATEGORY_ICON} {c.name}</option>)}
          </SelectField>
          <SelectField label={t("docFieldVisibility")} hint={t("docVisibilityHint")} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            {levels.map((l) => <option key={l} value={l}>{t(LEVEL_KEYS[l])}</option>)}
          </SelectField>
          <TextAreaField label={t("docFieldNote")} value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} />
          <div className="field">
            <label htmlFor={fileId} className="field__label">{document ? t("docReplaceFile") : t("docFieldFile")}</label>
            <input id={fileId} type="file" className="input" accept={DOCUMENT_ACCEPT} onChange={(e) => void choose(e.target.files?.[0])} />
            <p className="field__hint">{t("docFileHint")}</p>
            {fileError && <p className="field__error" role="alert">{fileError}</p>}
          </div>
          {progress !== null && save.isPending && <progress className="doc-progress" max={1} value={progress} aria-label={t("docUploading")} />}
        </form>
      ) : (
        <dl className="doc-facts">
          {category && <div><dt>{t("docFieldCategory")}</dt><dd>{category.icon ?? FALLBACK_CATEGORY_ICON} {category.name}</dd></div>}
          {document?.note && <div><dt>{t("docFieldNote")}</dt><dd>{document.note}</dd></div>}
        </dl>
      )}
      {failure && <ErrorNotice error={failure} />}
    </Dialog>
  );
}
