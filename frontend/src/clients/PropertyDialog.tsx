import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { parseMoney } from "../invoices/money";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { SelectField, TextAreaField, TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";
import { visitError } from "../visits/labels";
import { ROOM_NAME_MAX, ROOMS_MAX, starterRooms } from "../visits/rooms";
import type { ClientKind, Property, RoomInput } from "./api";
import { KIND_KEYS } from "./ClientDialog";
import { useDeleteProperty, useSaveProperty, useSaveRooms } from "./hooks";

const KINDS: ClientKind[] = ["airbnb", "commercial", "post_construction", "other"];

/** One line of the room editor: `id` is the saved room's (kept through renames and moves), null for a new one. */
type RoomRow = { key: number; id: number | null; name: string };

const roomBad = (r: RoomRow) => r.name.trim() === "" || r.name.trim().length > ROOM_NAME_MAX;
const sameRooms = (a: RoomInput[], b: RoomInput[]) => a.length === b.length && a.every((r, i) => r.id === b[i]!.id && r.name === b[i]!.name);

/** Add or change a property of a client (administrators): its details, the photos-required switch and its rooms. */
export function PropertyDialog({ clientId, property, onClose, onSaved }: { clientId: number; property: Property | null; onClose: () => void; onSaved?: (p: Property) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useSaveProperty(clientId);
  const saveRooms = useSaveRooms();
  const remove = useDeleteProperty();
  const [name, setName] = useState(property?.name ?? "");
  const [kind, setKind] = useState<ClientKind>(property?.kind ?? "airbnb");
  const [address, setAddress] = useState(property?.address ?? "");
  const [city, setCity] = useState(property?.city ?? "");
  const [listing, setListing] = useState(property?.listing_url ?? "");
  const [notes, setNotes] = useState(property?.access_notes ?? "");
  const [price, setPrice] = useState(property?.visit_price ?? "");
  const [photosRequired, setPhotosRequired] = useState(property?.photos_required ?? false);
  const [rooms, setRooms] = useState<RoomRow[]>(() => (property?.rooms ?? []).map((r, i) => ({ key: i + 1, id: r.id, name: r.name })));
  const [nextKey, setNextKey] = useState((property?.rooms?.length ?? 0) + 1);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  // A new property saved once (its rooms then failed) is changed, not created again, by the next Save.
  const [savedId, setSavedId] = useState<number | undefined>(property?.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listingBad = listing.trim() !== "" && !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(listing.trim());
  const priceBad = price.trim() !== "" && parseMoney(price) === null;
  const roomsBad = rooms.length > ROOMS_MAX || rooms.some(roomBad);
  const invalid = !name.trim() || listingBad || priceBad || roomsBad;
  const busy = save.isPending || saveRooms.isPending;
  const failure = save.error ?? remove.error;
  const starter = rooms.length === 0 ? starterRooms(kind, t) : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid || busy) return;
    const clean = (v: string) => v.trim() || null;
    const roomList: RoomInput[] = rooms.map((r) => ({ id: r.id, name: r.name.trim() }));
    const before: RoomInput[] = (property?.rooms ?? []).map((r) => ({ id: r.id, name: r.name }));
    try {
      const saved = await save.mutateAsync({ id: savedId, input: { name: name.trim(), kind, address: clean(address), city: clean(city), listing_url: clean(listing), access_notes: clean(notes), visit_price: price.trim() ? parseMoney(price) : null, photos_required: photosRequired } });
      setSavedId(saved.id);
      if (!sameRooms(roomList, before)) await saveRooms.mutateAsync({ propertyId: saved.id, rooms: roomList });
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

  const rename = (key: number, value: string) => setRooms((prev) => prev.map((r) => (r.key === key ? { ...r, name: value } : r)));
  const move = (index: number, by: -1 | 1) =>
    setRooms((prev) => {
      const next = [...prev];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row!);
      return next;
    });
  const add = (names: string[]) => {
    const room = names.map((n, i) => ({ key: nextKey + i, id: null, name: n }));
    setRooms((prev) => [...prev, ...room].slice(0, ROOMS_MAX));
    setNextKey(nextKey + names.length);
    if (names.length === 1) setFocusKey(nextKey);
  };

  const footer = (
    <>
      {property && !confirmDelete && <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)}>{t("delete")}</Button>}
      {property && confirmDelete && <Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => void doDelete()}>{t("propDeleteConfirm")}</Button>}
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form="property-form" variant="primary" busy={busy} disabled={invalid}>{t("save")}</Button>
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
        <TextField label={t("invVisitPrice")} hint={t("invVisitPriceHint")} inputMode="decimal" placeholder="120.00" value={price} maxLength={12} error={priceBad ? t("invAmountInvalid") : null} onChange={(e) => setPrice(e.target.value)} />
        <TextAreaField label={t("propFieldAccess")} hint={t("propAccessHint")} rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />

        <div className="field">
          <label className="check room-check">
            <input type="checkbox" checked={photosRequired} aria-describedby="property-photos-hint" onChange={(e) => setPhotosRequired(e.target.checked)} />
            {t("visPhotosRequired")}
          </label>
          <p id="property-photos-hint" className="field__hint">{t("visPhotosRequiredHint")}</p>
        </div>

        <fieldset className="room-editor">
          <legend className="field__label">{t("visRooms")}</legend>
          <p className="field__hint">{t("visRoomsHint")}</p>
          {rooms.length === 0 ? (
            <div className="room-starter">
              <p>{t("visRoomsNone")} {t("visRoomsSuggested", { rooms: starter.join(", ") })}</p>
              <Button icon="check" onClick={() => add(starter)}>{t("visRoomsUseStarter")}</Button>
            </div>
          ) : (
            <ol className="room-list">
              {rooms.map((r, i) => (
                <li key={r.key} className="room-row">
                  <TextField
                    label={t("visRoomName", { n: i + 1 })}
                    value={r.name}
                    maxLength={ROOM_NAME_MAX}
                    autoFocus={r.key === focusKey}
                    error={roomBad(r) ? t("visRoomNameRequired") : null}
                    onChange={(e) => rename(r.key, e.target.value)}
                  />
                  <div className="room-row__actions">
                    <IconButton icon="chev-up" label={t("visRoomUp", { n: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon="chev-down" label={t("visRoomDown", { n: i + 1 })} disabled={i === rooms.length - 1} onClick={() => move(i, 1)} />
                    <IconButton icon="trash" label={t("visRoomRemove", { n: i + 1 })} onClick={() => setRooms((prev) => prev.filter((x) => x.key !== r.key))} />
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="room-editor__add">
            <Button icon="plus" disabled={rooms.length >= ROOMS_MAX} onClick={() => add([""])}>{t("visRoomAdd")}</Button>
            {rooms.length >= ROOMS_MAX && <p className="field__hint">{t("visRoomsMax")}</p>}
          </div>
        </fieldset>
      </form>
      {failure && <ErrorNotice error={failure} />}
      {!failure && saveRooms.error && <div className="notice notice--error" role="alert"><p>{visitError(saveRooms.error, t)}</p></div>}
    </Dialog>
  );
}
