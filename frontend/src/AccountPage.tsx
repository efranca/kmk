import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "./api";
import AvatarPicker from "./AvatarPicker";
import { CalendarFeedCard } from "./settings/CalendarFeedCard";
import ChangePassword from "./ChangePassword";
import MfaBanner from "./MfaBanner";
import MfaSetup from "./MfaSetup";
import { displayName } from "./person";
import { memberColor } from "./ui/memberColor";
import SecuritySection from "./SecuritySection";

export default function AccountPage({
  user,
  csrfToken,
  mfaEnabled,
  recoveryCodesLeft,
  onMfaChange,
  onAvatarChanged,
}: {
  user: User;
  csrfToken: string;
  mfaEnabled: boolean;
  recoveryCodesLeft: number | null;
  onMfaChange: (enabled: boolean) => void;
  /** Runs after the picture was changed, so the signed-in user (and every face) is read again. */
  onAvatarChanged: () => void;
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
      {recoveryCodesLeft !== null && <p className="notice" role="status">{t("codesRemaining", { count: recoveryCodesLeft })}</p>}
      {!mfaEnabled && <MfaBanner role={user.role} />}
      <div className="settings-layout account-layout">
        <section className="settings-card profile-card" aria-label={displayName(user)}>
          <AvatarPicker
            person={{ id: user.id, name: displayName(user), color: memberColor(user.id), avatar_url: user.avatar_url }}
            csrfToken={csrfToken}
            onChanged={onAvatarChanged}
            heading={
              <div className="profile-card__who">
                <strong>{displayName(user)}</strong>
                {user.name && <span className="muted">{user.username}</span>}
                <span className="chip-tag" title={t("roleLabel")}>{t(`role_${user.role}`)}</span>
              </div>
            }
          />
        </section>
        <SecuritySection csrfToken={csrfToken} mfaEnabled={mfaEnabled} onEnroll={() => setEnrolling(true)} onDisabled={() => onMfaChange(false)} />
        <ChangePassword csrfToken={csrfToken} />
        <CalendarFeedCard csrfToken={csrfToken} />
      </div>
    </>
  );
}
