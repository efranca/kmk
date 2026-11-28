import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";
import { useSendInvoice } from "./hooks";
import type { Invoice } from "./types";

/** Emails the invoice's PDF to the client's address (which can be changed here). A failure leaves the dialog open. */
export function SendDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const send = useSendInvoice();
  const [to, setTo] = useState(invoice.bill_email ?? "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!to.trim()) return;
    try {
      await send.mutateAsync({ id: invoice.id, to: to.trim() });
      toast(t("invSendDone"));
      onClose();
    } catch {
      // shown from the mutation's error
    }
  }

  const footer = (
    <>
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form="invoice-send-form" variant="primary" icon="send" busy={send.isPending} disabled={!to.trim()}>{t("send")}</Button>
    </>
  );
  return (
    <Dialog open title={t("invSendTitle", { ref: invoice.reference })} onClose={onClose} footer={footer}>
      <form id="invoice-send-form" className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        <TextField label={t("invSendTo")} hint={t("invSendHint")} type="email" inputMode="email" autoComplete="off" value={to} maxLength={254} autoFocus onChange={(e) => setTo(e.target.value)} />
      </form>
      {send.error && <ErrorNotice error={send.error} />}
    </Dialog>
  );
}
