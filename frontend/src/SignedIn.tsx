import { useTranslation } from "react-i18next";

import type { User } from "./api";

export default function SignedIn({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t("welcome", { name: user.username })}</h1>
      <p className="status">
        {t("roleLabel")}: {t(`role_${user.role}`)}
      </p>
      <button type="button" onClick={onSignOut}>{t("signOut")}</button>
    </>
  );
}
