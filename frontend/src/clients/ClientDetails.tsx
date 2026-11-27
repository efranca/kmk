import { useTranslation } from "react-i18next";

import type { ClientDetail } from "./api";
import { KIND_KEYS } from "./ClientDialog";
import { googleMapsUrl, placeText } from "./maps";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** The Details tab: who the client is, one-tap ways to reach them, the facts, and (for administrators) the internal notes. */
export function ClientDetails({ client }: { client: ClientDetail }) {
  const { t } = useTranslation();
  const place = placeText(client.address, client.city);
  const phone = client.phone ? client.phone.replace(/[^\d+]/g, "") : "";
  const facts: [string, string | null][] = [
    [t("clientFieldContact"), client.contact_name],
    [t("clientFieldEmail"), client.email],
    [t("clientFieldPhone"), client.phone],
    [t("clientFieldAddress"), place || null],
  ];
  return (
    <div className="clientdetails">
      <div className="clientdetails__hero">
        <span className="clientdetails__avatar" aria-hidden="true">{initials(client.name)}</span>
        <div>
          <h2>{client.name}</h2>
          <span className="client__kinds">{client.kinds.map((k) => <span key={k} className="chip-tag">{t(KIND_KEYS[k])}</span>)}</span>
        </div>
      </div>
      {(phone || client.email || place) && (
        <div className="clientdetails__actions">
          {phone && <a className="btn btn--secondary" href={`tel:${phone}`}>{t("clientCall")}</a>}
          {client.email && <a className="btn btn--secondary" href={`mailto:${client.email}`}>{t("clientWriteEmail")}</a>}
          {place && <a className="btn btn--secondary" href={googleMapsUrl(place)} target="_blank" rel="noopener noreferrer">{t("propGoogleMaps")}</a>}
        </div>
      )}
      <dl className="clientdetails__facts">
        {facts.filter(([, v]) => v).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      {client.notes && (
        <aside className="clientdetails__notes" aria-label={t("clientFieldNotes")}>
          <strong>{t("clientFieldNotes")}</strong>
          <p>{client.notes}</p>
        </aside>
      )}
    </div>
  );
}
