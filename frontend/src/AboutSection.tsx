import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchVersion } from "./api";
import { Dialog } from "./ui/Dialog";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Which build is running: the app (fixed when it was built) and the server (asked for). */
export default function AboutSection({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const server = useQuery({ queryKey: ["version"], queryFn: fetchVersion, staleTime: 60_000, enabled: open });
  const unknown = t("aboutUnknown");
  const when = (iso: string | null) => {
    const date = iso ? new Date(iso) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(i18n.language, { dateStyle: "long", timeStyle: "short" }) : unknown;
  };
  const info = server.data ?? null;
  const mismatch = Boolean(__BUILD_COMMIT__ && info?.commit && info.commit !== __BUILD_COMMIT__);
  return (
    <Dialog open={open} title={t("navAbout")} onClose={onClose}>
      <div className="cards">
        <section className="section settings-card" aria-label={t("aboutApp")}>
          <h2>{t("aboutApp")}</h2>
          <dl className="about">
            <Row label={t("aboutVersion")} value={__APP_VERSION__} />
            <Row label={t("aboutCommit")} value={__BUILD_COMMIT__ || unknown} />
            <Row label={t("aboutBuilt")} value={when(__BUILD_TIME__)} />
          </dl>
        </section>
        <section className="section settings-card" aria-label={t("aboutServer")}>
          <h2>{t("aboutServer")}</h2>
          <dl className="about">
            <Row label={t("aboutVersion")} value={info?.version ?? unknown} />
            <Row label={t("aboutCommit")} value={info?.commit || unknown} />
            <Row label={t("aboutBuilt")} value={when(info?.builtAt ?? null)} />
          </dl>
        </section>
      </div>
      {mismatch && <p className="error" role="status">{t("aboutMismatch")}</p>}
    </Dialog>
  );
}
