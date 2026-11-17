import { useTranslation } from "react-i18next";

export default function NotFound({ onHome }: { onHome: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t("notFoundTitle")}</h1>
      <p className="status">{t("notFoundText")}</p>
      <p>
        <a href="/" onClick={(e) => { e.preventDefault(); onHome(); }}>{t("notFoundHome")}</a>
      </p>
    </>
  );
}
