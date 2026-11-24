import type { TFunction } from "i18next";

/** The person's words for a failed request: its API error code (`err_<code>`), else a generic line. */
export function errorMessage(error: unknown, t: TFunction): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const key = `err_${code}`;
  return code && t(key, { defaultValue: "" }) ? t(key) : t("err_unknown");
}
