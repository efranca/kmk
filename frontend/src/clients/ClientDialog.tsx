import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { SelectField, TextAreaField, TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";
import type { Client, ClientInput, ClientKind } from "./api";
import { useDeleteClient, useSaveClient } from "./hooks";

const KINDS: ClientKind[] = ["airbnb", "commercial", "post_construction", "other"];
export const KIND_KEYS: Record<ClientKind, string> = { airbnb: "clientKindAirbnb", commercial: "clientKindCommercial", post_construction: "clientKindPostConstruction", other: "clientKindOther" };

/** Add or change a client (administrators). `prefill` starts a new one from a quote; `quoteId` links that quote when saved. */
export function ClientDialog({ client, prefill, quoteId, onClose, onSaved, onDeleted }: { client: Client | null; prefill?: Partial<ClientInput>; quoteId?: number; onClose: () => void; onSaved?: (client: Client) => void; onDeleted?: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useSaveClient();
  const remove = useDeleteClient();
  const start = client ?? prefill;
  const [name, setName] = useState(start?.name ?? "");
  const [kind, setKind] = useState<ClientKind>(start?.kind ?? "other");
  const [contact, setContact] = useState(start?.contact_name ?? "");
  const [email, setEmail] = useState(start?.email ?? "");
  const [phone, setPhone] = useState(start?.phone ?? "");
  const [address, setAddress] = useState(start?.address ?? "");
  const [city, setCity] = useState(start?.city ?? "");
  const [notes, setNotes] = useState(start?.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const failure = save.error ?? remove.error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const clean = (v: string) => v.trim() || null;
    const input: ClientInput = { name: name.trim(), kind, contact_name: clean(contact), email: clean(email), phone: clean(phone), address: clean(address), city: clean(city), notes: clean(notes), ...(client || !quoteId ? {} : { quote_id: quoteId }) };
    try {
      const saved = await save.mutateAsync({ id: client?.id, input });
      toast(t("clientSaved"));
      onSaved?.(saved);
      onClose();
    } catch {
      // shown from the mutation's error
    }
  }

  async function doDelete() {
    if (!client) return;
    try {
      await remove.mutateAsync(client.id);
      toast(t("clientDeleted"));
      onClose();
      onDeleted?.();
    } catch {
      // shown from the mutation's error
    }
  }

  const footer = (
    <>
      {client && !confirmDelete && <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)}>{t("delete")}</Button>}
      {client && confirmDelete && <Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => void doDelete()}>{t("clientDeleteConfirm")}</Button>}
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form="client-form" variant="primary" busy={save.isPending} disabled={!name.trim()}>{t("save")}</Button>
    </>
  );

  return (
    <Dialog open title={client ? t("clientEdit") : t("clientNew")} onClose={onClose} footer={footer}>
      <form id="client-form" className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        <TextField label={t("clientFieldName")} value={name} maxLength={150} autoFocus onChange={(e) => setName(e.target.value)} />
        <SelectField label={t("clientFieldKind")} value={kind} onChange={(e) => setKind(e.target.value as ClientKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{t(KIND_KEYS[k])}</option>)}
        </SelectField>
        <TextField label={t("clientFieldContact")} value={contact} maxLength={100} onChange={(e) => setContact(e.target.value)} />
        <div className="client-f2">
          <TextField label={t("clientFieldEmail")} type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
          <TextField label={t("clientFieldPhone")} type="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <TextField label={t("clientFieldAddress")} value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
        <TextField label={t("clientFieldCity")} value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} />
        <TextAreaField label={t("clientFieldNotes")} hint={t("clientNotesHint")} rows={3} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
      </form>
      {failure && <ErrorNotice error={failure} />}
    </Dialog>
  );
}
