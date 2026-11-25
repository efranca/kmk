import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ErrorNotice } from "../ui/Feedback";
import { TextAreaField, TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";
import { useRetryMessage, useSendMessage } from "./hooks";
import type { QuoteDetail } from "./types";

const swallow = (p: Promise<unknown>) => void p.catch(() => undefined); // the failure is shown from the mutation's error

/** `<input type="datetime-local">` wants local wall-clock text. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The history with the customer, the reply box, and "Add customer reply" for answers pasted from the team's mailbox. */
export function Conversation({ quote }: { quote: QuoteDetail }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const send = useSendMessage(quote.id);
  const retry = useRetryMessage(quote.id);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pastedAt, setPastedAt] = useState(() => localInput(new Date()));
  const when = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  async function reply(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const updated = await send.mutateAsync({ direction: "out", subject: (subject ?? quote.default_subject).trim(), body });
    const last = updated.conversation.at(-1);
    toast(t(last?.delivery === "failed" ? "quoteToastNotSent" : "quoteToastSent"));
    setBody("");
    setSubject(null);
  }

  async function paste(e: FormEvent) {
    e.preventDefault();
    if (!pasted.trim()) return;
    await send.mutateAsync({ direction: "in", body: pasted, sent_at: new Date(pastedAt).toISOString() });
    toast(t("quoteToastPasted"));
    setPasted("");
    setPasting(false);
  }

  return (
    <section className="section quote-card">
      <h2>{t("quoteConversation")}</h2>
      {quote.conversation.length === 0 ? <p className="status">{t("quoteConvEmpty")}</p> : (
        <ol className="quote-thread">
          {quote.conversation.map((m) => (
            <li key={m.id} className={`quote-msg quote-msg--${m.direction}`}>
              <p className="quote-msg__head">
                {m.direction === "out" ? t("quoteSentBy", { name: m.author?.name ?? "" }) : t("quotePastedBy", { name: m.author?.name ?? "" })} · {when(m.sent_at)}
              </p>
              {m.subject && <p className="quote-msg__subject">{m.subject}</p>}
              <p className="quote-body">{m.body}</p>
              {m.delivery === "failed" && (
                <p className="quote-msg__failed">
                  <span>{t("quoteNotSent")}</span>
                  <Button icon="repeat" busy={retry.isPending} onClick={() => swallow(retry.mutateAsync(m.id))}>{t("retry")}</Button>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <form className="quote-reply" onSubmit={(e) => swallow(reply(e))}>
        <h3>{t("quoteReplyTitle")}</h3>
        <TextField label={t("quoteSubject")} value={subject ?? quote.default_subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        <TextAreaField label={t("quoteBody")} value={body} maxLength={20000} rows={6} onChange={(e) => setBody(e.target.value)} />
        {send.error && <ErrorNotice error={send.error} />}
        <div className="quote-reply__actions">
          <Button variant="primary" type="submit" icon="check" busy={send.isPending && !pasting}>{t("quoteSend")}</Button>
          <Button onClick={() => { send.reset(); setPasting(true); }}>{t("quotePaste")}</Button>
        </div>
      </form>

      <Dialog
        open={pasting} title={t("quotePaste")} onClose={() => setPasting(false)}
        footer={<><Button variant="ghost" onClick={() => setPasting(false)}>{t("cancel")}</Button><Button variant="primary" type="submit" form="quote-paste-form" busy={send.isPending}>{t("quotePasteSave")}</Button></>}
      >
        <form id="quote-paste-form" onSubmit={(e) => swallow(paste(e))}>
          <p className="status">{t("quotePasteHint")}</p>
          <TextAreaField label={t("quotePasteBody")} value={pasted} maxLength={20000} rows={8} onChange={(e) => setPasted(e.target.value)} />
          <TextField label={t("quotePasteDate")} type="datetime-local" value={pastedAt} max={localInput(new Date())} onChange={(e) => setPastedAt(e.target.value)} />
        </form>
        {send.error && pasting && <ErrorNotice error={send.error} />}
      </Dialog>
    </section>
  );
}
