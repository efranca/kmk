import { useTranslation } from "react-i18next";

import { googleMapsUrl, isWebLink, wazeUrl } from "./maps";

/** Maps, Waze and (when there is one) the listing, as buttons next to an address. */
export function PlaceLinks({ place, listingUrl }: { place: string; listingUrl?: string | null }) {
  const { t } = useTranslation();
  return (
    <span className="placelinks">
      {place && <a className="btn btn--secondary" href={googleMapsUrl(place)} target="_blank" rel="noopener noreferrer">{t("propGoogleMaps")}</a>}
      {place && <a className="btn btn--secondary" href={wazeUrl(place)} target="_blank" rel="noopener noreferrer">{t("propWaze")}</a>}
      {isWebLink(listingUrl) && <a className="btn btn--secondary" href={listingUrl} target="_blank" rel="noopener noreferrer">{t("propListing")}</a>}
    </span>
  );
}
