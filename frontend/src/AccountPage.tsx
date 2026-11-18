import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "./api";
import ChangePassword from "./ChangePassword";
import MfaBanner from "./MfaBanner";
import MfaSetup from "./MfaSetup";
import SecuritySection from "./SecuritySection";

export default function AccountPage({
  user,
  csrfToken,
  mfaEnabled,
  recoveryCodesLeft,
  onMfaChange,
}: {
  user: User;
  csrfToken: string;
  mfaEnabled: boolean;
  recoveryCodesLeft: number | null;
  onMfaChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const [enrolling, setEnrolling] = useState(false);

  if (enrolling) {
    return (
      <MfaSetup
        csrfToken={csrfToken}
        onDone={() => {
          setEnrolling(false);
          onMfaChange(true);
        }}
        onCancel={() => setEnrolling(false)}
      />
    );
  }

  return (
    <>
      <h1>{t("navAccount")}</h1>
      <p className="status">
        {user.name ? `${user.name} · ${user.username}` : user.username} · {t("roleLabel")}: {t(`role_${user.role}`)}
      </p>
      {recoveryCodesLeft !== null && <p className="notice" role="status">{t("codesRemaining", { count: recoveryCodesLeft })}</p>}
      {!mfaEnabled && <MfaBanner role={user.role} />}
      <SecuritySection csrfToken={csrfToken} mfaEnabled={mfaEnabled} onEnroll={() => setEnrolling(true)} onDisabled={() => onMfaChange(false)} />
      <ChangePassword csrfToken={csrfToken} />
    </>
  );
}
