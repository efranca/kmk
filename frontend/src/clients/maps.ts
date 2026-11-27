/** Links that open the address in a maps app (on a phone they open Google Maps or Waze itself). */
export const placeText = (address: string | null, city: string | null): string => [address, city].filter(Boolean).join(", ");

export const googleMapsUrl = (place: string): string => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
export const wazeUrl = (place: string): string => `https://waze.com/ul?q=${encodeURIComponent(place)}&navigate=yes`;

/** Only web links are ever made tappable (the server checks too). */
export const isWebLink = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);
