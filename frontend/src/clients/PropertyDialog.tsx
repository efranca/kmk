import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { SelectField, TextAreaField, TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";
import type { ClientKind, Property } from "./api";
import { KIND_KEYS } from "./ClientDialog";
import { useDeleteProperty, useSaveProperty } from "./hooks";

const KINDS: ClientKind[] = ["airbnb", "commercial", "post_construction", "other"];

/** Add or change a property of a client (administrators). */
export function PropertyDialog({ clientId, property, onClose, onSaved }: { clientId: number; property: Property | null; onClose: () => void; onSaved?: (p: Property) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useSaveProperty(clientId);
  const remove = useDeleteProperty();
  const [name, setName] = useState(property?.name ?? "");
  const [kind, setKind] = useState<ClientKind>(property?.kind ?? "airbnb");
  const [address, setAddress] = useState(property?.address ?? "");
  const [city, setCity] = useState(property?.city ?? "");
  const [listing, setListing] = useState(property?.listing_url ?? "");
  const [notes, setNotes] = useState(property?.access_notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listingBad = listing.trim() !== "" && !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(listing.trim());
  const failure = save.error ?? remove.error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || listingBad) return;
    const clean = (v: string) => v.trim() || null;
    try {
      const saved = await save.mutateAsync({ id: property?.id, input: { name: name.trim(), kind, address: clean(address), city: clean(city), listing_url: clean(listing), access_notes: clean(notes) } });
      toast(t("propSaved"));
      onSaved?.(saved);
      onClose();
    } catch {
      // shown from the mutation's error
    }
  }

  async function doDelete() {
    if (!property) return;
    try {
      await remove.mutateAsync(property.id);
      toast(t("propDeleted"));
      onClose();
    } catch {
      // shown from the mutation's error
    }
  }

  const footer = (
    <>
      {property && !confirmDelete && <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)}>{t("delete")}</Button>}
      {property && confirmDelete && <Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => void doDelete()}>{t("propDeleteConfirm")}</Button>}
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form="property-form" variant="primary" busy={save.isPending} disabled={!name.trim() || listingBad}>{t("save")}</Button>
    </>
  );

  return (
    <Dialog open title={property ? t("propEdit") : t("propNew")} onClose={onClose} footer={footer}>
      <form id="property-form" className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        <TextField label={t("propFieldName")} hint={t("propNameHint")} value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
        <SelectField label={t("propFieldKind")} value={kind} onChange={(e) => setKind(e.target.value as ClientKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{t(KIND_KEYS[k])}</option>)}
        </SelectField>
        <TextField label={t("clientFieldAddress")} value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
        <TextField label={t("clientFieldCity")} value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} />
        <TextField label={t("propFieldListing")} type="url" inputMode="url" placeholder="https://www.airbnb.com/rooms/…" value={listing} maxLength={300} error={listingBad ? t("propErrListing") : null} onChange={(e) => setListing(e.target.value)} />
        <TextAreaField label={t("propFieldAccess")} hint={t("propAccessHint")} rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      </form>
      {failure && <ErrorNotice error={failure} />}
    </Dialog>
  );
}
