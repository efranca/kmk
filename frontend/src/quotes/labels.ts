import type { QuoteFilter, QuoteKind, QuoteStatus } from "./types";

export const STATUS_KEYS: Record<QuoteStatus, string> = {
  new: "quoteStatusNew", replied: "quoteStatusReplied", customer_replied: "quoteStatusCustomerReplied", won: "quoteStatusWon", lost: "quoteStatusLost",
};
export const TABS: QuoteFilter[] = ["new", "replied", "customer_replied", "won", "lost", "all"];
export const TAB_KEYS: Record<QuoteFilter, string> = { ...STATUS_KEYS, all: "quoteTabAll" };
export const KIND_KEYS: Record<QuoteKind, string> = { airbnb: "quoteKindAirbnb", commercial: "quoteKindCommercial" };
export const PROPERTY_KEYS: Record<string, string> = {
  house: "quotePropHouse", apartment: "quotePropApartment", condo: "quotePropCondo", other: "quotePropOther", office: "quotePropOffice",
  clinic: "quotePropClinic", shop: "quotePropShop", restaurant: "quotePropRestaurant", industrial: "quotePropIndustrial",
};
export const FREQUENCY_KEYS: Record<string, string> = {
  once: "quoteFreqOnce", per_booking: "quoteFreqPerBooking", weekly: "quoteFreqWeekly", biweekly: "quoteFreqBiweekly", monthly: "quoteFreqMonthly",
  post_construction: "quoteFreqPostConstruction", unsure: "quoteFreqUnsure",
};
export const LOCALE_NAMES: Record<string, string> = { "fr-CA": "Français", "en-CA": "English", "pt-BR": "Português" };
