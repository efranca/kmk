import { useTranslation } from "react-i18next";

import type { User } from "./api";
import MfaBanner from "./MfaBanner";
import { displayName } from "./person";
import { welcomeBlocks } from "./welcomeContent";

export default function WelcomePage({
  user,
  mfaEnabled,
  recoveryCodesLeft,
}: {
  user: User;
  mfaEnabled: boolean;
  recoveryCodesLeft: number | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t("welcome", { name: displayName(user) })}</h1>
      <h2 className="lead">{t("welcomeTitle")}</h2>
      <p className="status">{t("welcomeIntro")}</p>
      {recoveryCodesLeft !== null && <p className="notice" role="status">{t("codesRemaining", { count: recoveryCodesLeft })}</p>}
      {!mfaEnabled && <MfaBanner role={user.role} />}
      {welcomeBlocks.map((b) => (
        <section className="section" key={b.titleKey}>
          <h2>{t(b.titleKey)}</h2>
          <p>{t(b.bodyKey)}</p>
        </section>
      ))}
    </>
  );
}
