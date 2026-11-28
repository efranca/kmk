import { useTranslation } from "react-i18next";

import { formatMoney } from "../invoices/money";
import { Button } from "../ui/Button";
import type { Property } from "./api";
import { KIND_KEYS } from "./ClientDialog";
import { placeText } from "./maps";
import { PlaceLinks } from "./PlaceLinks";

/** One property: name and kind, the address with its map links, the listing, the access notes. */
export function PropertyCard({ property, onEdit }: { property: Property; onEdit?: () => void }) {
  const { t, i18n } = useTranslation();
  const place = placeText(property.address, property.city);
  return (
    <article className="propcard" aria-label={property.name}>
      <header className="propcard__head">
        <strong>{property.name}</strong>
        <span className="chip-tag">{t(KIND_KEYS[property.kind])}</span>
        {onEdit && <Button variant="ghost" icon="pencil" onClick={onEdit}>{t("propEdit")}</Button>}
      </header>
      {place && <p className="propcard__place">{place}</p>}
      <PlaceLinks place={place} listingUrl={property.listing_url} />
      {property.visit_price != null && <p className="propcard__price"><b>{t("invVisitPrice")}:</b> {formatMoney(property.visit_price, i18n.language)}</p>}
      {property.access_notes && <p className="propcard__access"><b>{t("propFieldAccess")}:</b> {property.access_notes}</p>}
    </article>
  );
}
