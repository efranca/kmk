import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DocumentDialog } from "../documents/DocumentDialog";
import { DocumentRow } from "../documents/DocumentRow";
import type { DocumentItem } from "../documents/api";
import { useDocuments } from "../documents/hooks";
import { Button } from "../ui/Button";
import { ErrorNotice, Loading } from "../ui/Feedback";

/** A client's documents, as on the Documents page: click one to see it, or add a new one that is already linked to this client. */
export function ClientDocuments({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const { data, isPending, isError, error, refetch } = useDocuments();
  const [open, setOpen] = useState<DocumentItem | "new" | null>(null);
  const categories = data?.categories ?? [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const mine = (data?.documents ?? []).filter((d) => d.client_id === clientId);
  return (
    <>
      {isPending ? <Loading /> : isError ? <ErrorNotice error={error} onRetry={() => void refetch()} /> : mine.length === 0 ? <p className="status">{t("clientNoDocuments")}</p> : (
        <ul className="docs">
          {mine.map((d) => <DocumentRow key={d.id} document={d} category={d.category_id ? categoryById.get(d.category_id) : undefined} onOpen={() => setOpen(d)} />)}
        </ul>
      )}
      <Button icon="plus" onClick={() => setOpen("new")}>{t("docNew")}</Button>
      {open && <DocumentDialog key={open === "new" ? "new" : open.id} document={open === "new" ? null : open} categories={categories} defaultClientId={clientId} onClose={() => setOpen(null)} />}
    </>
  );
}
