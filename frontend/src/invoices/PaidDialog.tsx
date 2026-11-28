import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { COMPANY_TIME_ZONE, todayIn } from "../schedule/scheduleDates";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";
import { useMarkPaid } from "./hooks";

/** Asks for the payment date (today by default) and marks the invoice as paid. */
export function PaidDialog({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const pay = useMarkPaid();
  const today = todayIn(COMPANY_TIME_ZONE);
  const [day, setDay] = useState(today);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!day || day > today) return;
    try {
      await pay.mutateAsync({ id: invoiceId, paidOn: day });
      toast(t("invPaidDone"));
      onClose();
    } catch {
      // shown from the mutation's error
    }
  }

  const footer = (
    <>
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form="invoice-paid-form" variant="primary" busy={pay.isPending} disabled={!day || day > today}>{t("save")}</Button>
    </>
  );
  return (
    <Dialog open title={t("invMarkPaid")} onClose={onClose} footer={footer}>
      <form id="invoice-paid-form" className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        <TextField label={t("invPaidDate")} type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
      </form>
      {pay.error && <ErrorNotice error={pay.error} />}
    </Dialog>
  );
}
