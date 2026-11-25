import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { useToast } from "../ui/toastContext";
import { useDeleteTask, useSaveTask } from "./hooks";
import { canChangeTask } from "./permissions";
import { TaskFields } from "./TaskFields";
import { emptyTaskForm, formToInput, taskToForm, validateTaskForm, type TaskFormErrors, type TaskFormValues } from "./taskForm";
import type { Task } from "./types";

interface TaskDialogProps {
  /** The task to edit, or null for a new one. */
  task: Task | null;
  onClose: () => void;
  /** A new task starts for these people (the ones picked on the Tasks page). */
  defaultPeople: number[];
}

export function TaskDialog({ task, onClose, defaultPeople }: TaskDialogProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { user } = useSession();
  const group = useId();
  const [values, setValues] = useState<TaskFormValues>(() => (task ? taskToForm(task) : emptyTaskForm(defaultPeople)));
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveTask();
  const remove = useDeleteTask();
  const editable = task === null || canChangeTask(user, task);
  const failure = save.error ?? remove.error;
  const formId = `${group}-form`;
  const when = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const swallow = (p: Promise<unknown>) => void p.catch(() => undefined); // the failure is shown from the mutation's error

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateTaskForm(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    await save.mutateAsync({ id: task?.id, input: formToInput(values) });
    toast(t(task ? "taskToastUpdated" : "taskToastCreated"));
    onClose();
  }

  async function doDelete() {
    if (!task) return;
    await remove.mutateAsync(task.id);
    toast(t("taskToastDeleted"));
    onClose();
  }

  const footer = !editable ? (
    <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
  ) : confirmDelete ? (
    <>
      <p className="dialog__question">{t("taskDeleteQuestion")}</p>
      <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t("cancel")}</Button>
      <Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => swallow(doDelete())}>{t("delete")}</Button>
    </>
  ) : (
    <>
      {task && <Button variant="danger" icon="trash" className="dialog__left" onClick={() => setConfirmDelete(true)}>{t("delete")}</Button>}
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button variant="primary" type="submit" form={formId} busy={save.isPending}>{t("save")}</Button>
    </>
  );

  return (
    <Dialog open title={t(task ? "taskFormEditTitle" : "taskFormNewTitle")} onClose={onClose} footer={footer}>
      {!editable && <p className="notice" role="note">{t("taskViewOnly")}</p>}
      <form id={formId} onSubmit={(e) => swallow(submit(e))} noValidate>
        <fieldset className="sched-form" disabled={!editable}>
          <TaskFields values={values} errors={errors} onChange={setValues} autoFocus={!task} autoIcon={!task} />
        </fieldset>
      </form>
      {task && (
        <p className="task-meta">
          {t("taskCreatedBy", { name: task.created_by?.name ?? t("createdByWebsite"), when: when(task.created_at) })}
          {task.updated_at !== task.created_at && <><br />{t("taskUpdatedBy", { name: task.updated_by?.name ?? t("createdByWebsite"), when: when(task.updated_at) })}</>}
        </p>
      )}
      {failure && <ErrorNotice error={failure} />}
    </Dialog>
  );
}
