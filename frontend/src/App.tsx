import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Status = "checking" | "ok" | "down";

export default function App() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    document.title = t("title");
    document.documentElement.lang = i18n.language;
  }, [t, i18n.language]);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => alive && setStatus(r.ok ? "ok" : "down"))
      .catch(() => alive && setStatus("down"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="card">
      <img className="logo" src="/logo-horizontal.png" alt="KMK Entretien Ménager" width="300" height="100" />
      <h1>{t("title")}</h1>
      {status !== "checking" && (
        <p className={`status ${status}`}>{t(status === "ok" ? "apiOk" : "apiDown")}</p>
      )}
    </main>
  );
}
