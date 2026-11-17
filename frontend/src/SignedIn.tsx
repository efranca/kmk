import { useTranslation } from "react-i18next";

import type { User } from "./api";
import ChangePassword from "./ChangePassword";

export default function SignedIn({ user, csrfToken, onSignOut }: { user: User; csrfToken: string; onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t("welcome", { name: user.username })}</h1>
      <p className="status">
        {t("roleLabel")}: {t(`role_${user.role}`)}
      </p>
      <ChangePassword csrfToken={csrfToken} />
      <button type="button" className="secondary" onClick={onSignOut}>{t("signOut")}</button>
    </>
  );
}
