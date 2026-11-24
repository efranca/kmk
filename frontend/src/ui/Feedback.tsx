import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "./Button";
import { errorMessage } from "./errors";

export function Loading() {
  const { t } = useTranslation();
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {t("checking")}
    </p>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="notice notice--error" role="alert">
      <p>{errorMessage(error, t)}</p>
      {onRetry && <Button onClick={onRetry}>{t("retry")}</Button>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
