import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { useClient } from "./hooks";
import { placeText } from "./maps";
import { PlaceLinks } from "./PlaceLinks";

/** At the top of an Agenda item: who it is for, where, how to reach them, and the maps buttons. Nothing when the person cannot read the client. */
export function EventPlace({ clientId, propertyId, onNavigate }: { clientId: number; propertyId: number | null; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const { data: client } = useClient(clientId);
  if (!client) return null;
  const property = client.properties.find((p) => p.id === propertyId) ?? null;
  const place = property ? placeText(property.address, property.city) : "";
  return (
    <section className="eventplace" aria-label={t("propEventPlace")}>
      <p className="eventplace__client">
        <a href={`/clients/${client.id}`} onClick={(e) => { e.preventDefault(); onNavigate?.(); navigate(`/clients/${client.id}`); }}>{client.name}</a>
        {client.phone && <> · <a href={`tel:${client.phone.replace(/[^\d+]/g, "")}`}>{client.phone}</a></>}
      </p>
      {property && (
        <>
          <p className="eventplace__place"><strong>{property.name}</strong>{place && <> · {place}</>}</p>
          <PlaceLinks place={place} listingUrl={property.listing_url} />
          {property.access_notes && <p className="eventplace__access"><b>{t("propFieldAccess")}:</b> {property.access_notes}</p>}
        </>
      )}
    </section>
  );
}
