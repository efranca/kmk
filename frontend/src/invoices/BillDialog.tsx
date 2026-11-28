import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { addDays, COMPANY_TIME_ZONE, todayIn } from "../schedule/scheduleDates";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";
import { useBillable, useCreateInvoice } from "./hooks";
import { formatDay } from "./labels";
import { formatMoney, parseMoney, sumMoney } from "./money";
import type { InvoiceInput } from "./types";

const FORTNIGHT = 15;
type Manual = { key: number; description: string; amount: string };
const keyOf = (o: { event_id: number; occurrence_date: string }) => `${o.event_id}:${o.occurrence_date}`;

/** Bills a client: the past cleanings of a period (ticked, priced from their property), manual lines, extra costs. */
export function BillDialog({ clientId, onClose, onCreated }: { clientId: number; onClose: () => void; onCreated: (invoiceId: number) => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const create = useCreateInvoice();
  const today = todayIn(COMPANY_TIME_ZONE);
  const [from, setFrom] = useState(addDays(today, -FORTNIGHT));
  const [to, setTo] = useState(today);
  const [issued, setIssued] = useState(today);
  const [extra, setExtra] = useState("");
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<Manual[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const valid = from !== "" && to !== "" && from <= to;
  const billable = useBillable(clientId, from, to, valid);
  const occurrences = valid ? billable.data ?? [] : [];

  const lines = occurrences
    .filter((o) => !unticked.has(keyOf(o)))
    .map((o) => ({ o, description: (descriptions[keyOf(o)] ?? o.description).trim(), amount: parseMoney(amounts[keyOf(o)] ?? o.price ?? "") }));
  const manualLines = manual.map((m) => ({ m, description: m.description.trim(), amount: parseMoney(m.amount) }));
  const extraAmount = extra.trim() === "" ? "0.00" : parseMoney(extra);
  const allOk = lines.every((l) => l.description && l.amount !== null) && manualLines.every((l) => l.description && l.amount !== null) && extraAmount !== null && issued !== "";
  const count = lines.length + manualLines.length;
  const total = sumMoney([...lines.map((l) => l.amount), ...manualLines.map((l) => l.amount), extraAmount].filter((v): v is string => v !== null));
  const failure = create.error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!allOk || count === 0 || extraAmount === null) return;
    const input: InvoiceInput = {
      client_id: clientId,
      issued_on: issued,
      extra: extraAmount,
      lines: [
        ...lines.map((l) => ({ event_id: l.o.event_id, occurrence_date: l.o.occurrence_date, description: l.description, amount: l.amount! })),
        ...manualLines.map((l) => ({ description: l.description, amount: l.amount! })),
      ],
    };
    try {
      const invoice = await create.mutateAsync(input);
      toast(t("invCreated", { ref: invoice.reference }));
      onCreated(invoice.id);
      onClose();
    } catch (error) {
      if ((error as { code?: string }).code === "already_billed") void billable.refetch();
    }
  }

  const set = <T,>(setter: (f: (prev: Record<string, T>) => Record<string, T>) => void, key: string, value: T) => setter((prev) => ({ ...prev, [key]: value }));
  const toggle = (key: string) => setUnticked((prev) => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  const change = (key: number, patch: Partial<Manual>) => setManual((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  const footer = (
    <>
      <span className="dialog__spacer" />
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button type="submit" form="bill-form" variant="primary" busy={create.isPending} disabled={!allOk || count === 0}>{t("invCreate")}</Button>
    </>
  );

  return (
    <Dialog open title={t("invBillTitle")} onClose={onClose} footer={footer}>
      <form id="bill-form" className="doc-form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="bill-period">
          <TextField label={t("invPeriodFrom")} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <TextField label={t("invPeriodTo")} type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
        {valid && billable.isPending ? <Loading /> : billable.isError ? <ErrorNotice error={billable.error} onRetry={() => void billable.refetch()} /> : (
          <ul className="bill-lines">
            {occurrences.map((o) => {
              const key = keyOf(o);
              const ticked = !unticked.has(key);
              const amount = amounts[key] ?? o.price ?? "";
              const bad = ticked && parseMoney(amount) === null;
              const day = formatDay(o.date, i18n.language);
              return (
                <li key={key} className={bad ? "bill-line bill-line--bad" : "bill-line"}>
                  <input type="checkbox" checked={ticked} aria-label={t("invIncludeLine", { date: day })} onChange={() => toggle(key)} />
                  <input type="text" aria-label={t("invLineDescription")} value={descriptions[key] ?? o.description} maxLength={200} disabled={!ticked} onChange={(e) => set(setDescriptions, key, e.target.value)} />
                  <input type="text" inputMode="decimal" aria-label={t("invLineAmount")} aria-invalid={bad || undefined} placeholder="0.00" value={amount} maxLength={12} disabled={!ticked} onChange={(e) => set(setAmounts, key, e.target.value)} />
                  <span className="bill-line__date">{day}</span>
                </li>
              );
            })}
            {manual.map((m) => {
              const bad = !m.description.trim() || parseMoney(m.amount) === null;
              return (
                <li key={`m${m.key}`} className={bad ? "bill-line bill-line--bad" : "bill-line"}>
                  <Button variant="ghost" icon="trash" aria-label={t("invRemoveLine")} title={t("invRemoveLine")} onClick={() => setManual((prev) => prev.filter((x) => x.key !== m.key))} />
                  <input type="text" aria-label={t("invLineDescription")} value={m.description} maxLength={200} autoFocus onChange={(e) => change(m.key, { description: e.target.value })} />
                  <input type="text" inputMode="decimal" aria-label={t("invLineAmount")} aria-invalid={bad || undefined} placeholder="0.00" value={m.amount} maxLength={12} onChange={(e) => change(m.key, { amount: e.target.value })} />
                </li>
              );
            })}
          </ul>
        )}
        {valid && billable.isSuccess && occurrences.length === 0 && <EmptyState>{t("invNothingToBill")}</EmptyState>}
        <Button icon="plus" onClick={() => { setManual((prev) => [...prev, { key: nextKey, description: "", amount: "" }]); setNextKey(nextKey + 1); }}>{t("invAddLine")}</Button>
        <TextField label={t("invExtra")} inputMode="decimal" placeholder="0.00" value={extra} maxLength={12} error={extraAmount === null ? t("invAmountInvalid") : null} onChange={(e) => setExtra(e.target.value)} />
        <TextField label={t("invDateField")} type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
        <p className="bill-total" data-testid="bill-total"><span>{t("invTotal")}</span><span>{formatMoney(total, i18n.language)}</span></p>
      </form>
      {failure && <ErrorNotice error={failure} />}
    </Dialog>
  );
}
