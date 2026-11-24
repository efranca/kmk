import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchVersion } from "./api";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Which build is running: the app (fixed when it was built) and the server (asked for). */
export default function AboutSection() {
  const { t, i18n } = useTranslation();
  const server = useQuery({ queryKey: ["version"], queryFn: fetchVersion, staleTime: 60_000 });
  const unknown = t("aboutUnknown");
  const when = (iso: string | null) => {
    const date = iso ? new Date(iso) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(i18n.language, { dateStyle: "long", timeStyle: "short" }) : unknown;
  };
  const info = server.data ?? null;
  const mismatch = Boolean(__BUILD_COMMIT__ && info?.commit && info.commit !== __BUILD_COMMIT__);
  return (
    <section className="section settings-card">
      <h2>{t("settingsAbout")}</h2>
      <h3 className="about__title">{t("aboutApp")}</h3>
      <dl className="about">
        <Row label={t("aboutVersion")} value={__APP_VERSION__} />
        <Row label={t("aboutCommit")} value={__BUILD_COMMIT__ || unknown} />
        <Row label={t("aboutBuilt")} value={when(__BUILD_TIME__)} />
      </dl>
      <h3 className="about__title">{t("aboutServer")}</h3>
      <dl className="about">
        <Row label={t("aboutVersion")} value={info?.version ?? unknown} />
        <Row label={t("aboutCommit")} value={info?.commit || unknown} />
        <Row label={t("aboutBuilt")} value={when(info?.builtAt ?? null)} />
      </dl>
      {mismatch && <p className="error" role="status">{t("aboutMismatch")}</p>}
    </section>
  );
}
