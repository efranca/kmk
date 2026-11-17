import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "./api";
import ChangePassword from "./ChangePassword";
import MfaBanner from "./MfaBanner";
import MfaSetup from "./MfaSetup";
import SecuritySection from "./SecuritySection";

export default function SignedIn({
  user,
  csrfToken,
  mfaEnabled,
  recoveryCodesLeft,
  onMfaChange,
  onOpenAdmin,
  onSignOut,
}: {
  user: User;
  csrfToken: string;
  mfaEnabled: boolean;
  recoveryCodesLeft: number | null;
  onMfaChange: (enabled: boolean) => void;
  onOpenAdmin: () => void;
  onSignOut: () => void;
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
      <h1>{t("welcome", { name: user.username })}</h1>
      <p className="status">
        {t("roleLabel")}: {t(`role_${user.role}`)}
      </p>
      {recoveryCodesLeft !== null && <p className="notice" role="status">{t("codesRemaining", { count: recoveryCodesLeft })}</p>}
      {!mfaEnabled && <MfaBanner role={user.role} />}
      <SecuritySection csrfToken={csrfToken} mfaEnabled={mfaEnabled} onEnroll={() => setEnrolling(true)} onDisabled={() => onMfaChange(false)} />
      {user.role !== "user" && (
        <p>
          <a href="/admin" onClick={(e) => { e.preventDefault(); onOpenAdmin(); }}>{t("adminOpen")}</a>
        </p>
      )}
      <ChangePassword csrfToken={csrfToken} />
      <button type="button" className="secondary" onClick={onSignOut}>{t("signOut")}</button>
    </>
  );
}
