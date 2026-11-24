import { useTranslation } from "react-i18next";

import AboutSection from "./AboutSection";
import { PageHeader } from "./ui/PageHeader";

/** Which build is running (reached from the account menu). */
export default function AboutPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("navAbout")} />
      <AboutSection />
    </>
  );
}
