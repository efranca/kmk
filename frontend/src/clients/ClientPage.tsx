import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { useNarrow } from "../schedule/useNarrow";
import { useSession } from "../session";
import { Button, IconButton } from "../ui/Button";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { BillDialog } from "../invoices/BillDialog";
import { formatMoney } from "../invoices/money";
import { STATUS_KEYS } from "../invoices/labels";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import type { Property } from "./api";
import { ClientDetails } from "./ClientDetails";
import { ClientDialog } from "./ClientDialog";
import { ClientDocuments } from "./ClientDocuments";
import { PropertyCard } from "./PropertyCard";
import { PropertyDialog } from "./PropertyDialog";
import { useClient } from "./hooks";

type Tab = "details" | "properties" | "documents" | "tasks" | "events" | "quotes" | "invoices";
const TABS: Tab[] = ["details", "properties", "documents", "tasks", "events", "quotes", "invoices"];
const TAB_KEYS: Record<Tab, string> = { details: "clientTabDetails", properties: "clientTabProperties", documents: "clientTabDocuments", tasks: "clientTabTasks", events: "clientTabEvents", quotes: "clientTabQuotes", invoices: "clientTabInvoices" };

/** One client: the details, and what is linked to them (documents, tasks, Agenda items, quotes). */
export function ClientPage({ id }: { id: number }) {
  const { t, i18n } = useTranslation();
  const { navigate } = useRoute();
  const narrow = useNarrow();
  const canManage = useSession().user.role !== "user";
  const { data: client, isPending, isError, error, refetch } = useClient(id);
  const [tab, setTab] = useState<Tab>("details");
  const [editing, setEditing] = useState(false);
  const [billing, setBilling] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | "new" | null>(null);

  const back = <IconButton icon="chev-left" label={t("clientsTitle")} onClick={() => navigate("/clients")} />;
  if (isPending) return <div className="page"><Loading /></div>;
  if (isError || !client) return <div className="page"><div className="clientpage__top">{back}</div><ErrorNotice error={error} onRetry={() => void refetch()} /></div>;

  const documents = client.documents ?? [];
  const tasks = client.tasks ?? [];
  const events = client.events ?? [];
  const quotes = client.quotes ?? [];
  const invoices = client.invoices ?? [];
  const tabs = canManage ? TABS : (["details", "properties", "events"] as Tab[]); // Staff: the details and their own Schedule, nothing else
  const properties = client.properties ?? [];
  const counts: Record<Tab, number> = { details: 0, properties: properties.length, documents: documents.length, tasks: tasks.length, events: events.length, quotes: quotes.length, invoices: invoices.length };
  const empty = <p className="status">{t("clientNothingLinked")}</p>;

  return (
    <div className="page page--client">
      <PageHeader title={<span className="clientpage__top">{back}{client.name}</span>} actions={canManage ? (narrow ? <IconButton icon="pencil" label={t("clientEdit")} onClick={() => setEditing(true)} /> : <Button icon="pencil" onClick={() => setEditing(true)}>{t("clientEdit")}</Button>) : undefined} />
      <Segmented dropdown={narrow} label={t("clientTabs")} value={tab} onChange={setTab} options={tabs.map((x) => ({ value: x, label: counts[x] ? `${t(TAB_KEYS[x])} ${counts[x]}` : t(TAB_KEYS[x]) }))} />
      <section className="section client-card">
        {tab === "details" && (
          <ClientDetails client={client} />
        )}
        {tab === "properties" && (
          <>
            {properties.length === 0 ? empty : <div className="proplist">{properties.map((p) => <PropertyCard key={p.id} property={p} onEdit={canManage ? () => setEditingProperty(p) : undefined} />)}</div>}
            {canManage && <Button icon="plus" onClick={() => setEditingProperty("new")}>{t("propNew")}</Button>}
          </>
        )}
        {tab === "documents" && <ClientDocuments clientId={client.id} />}
        {tab === "tasks" && (tasks.length === 0 ? empty : (
          <ul className="client-links">{tasks.map((x) => <li key={x.id}><button type="button" onClick={() => navigate("/tasks")}>{x.title}</button><small>{x.due_date ?? ""}</small></li>)}</ul>
        ))}
        {tab === "events" && (events.length === 0 ? empty : (
          <ul className="client-links">{events.map((x) => <li key={x.id}><button type="button" onClick={() => navigate(`/schedule?view=day&date=${x.start_date}`)}>{x.title}</button><small>{x.start_date} {x.start_time ?? ""}</small></li>)}</ul>
        ))}
        {tab === "quotes" && (quotes.length === 0 ? empty : (
          <ul className="client-links">{quotes.map((x) => <li key={x.id}><button type="button" onClick={() => navigate(`/quotes/${x.id}`)}>{x.reference}</button><small>{x.submitted_at?.slice(0, 10) ?? ""}</small></li>)}</ul>
        ))}
        {tab === "invoices" && (
          <>
            {invoices.length === 0 ? empty : (
              <ul className="client-links client-invoices">
                {invoices.map((x) => (
                  <li key={x.id}>
                    <a href={`/invoices/${x.id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${x.id}`); }}>{x.reference}</a>
                    <small>{x.issued_on}</small>
                    <span>{formatMoney(x.total, i18n.language)}</span>
                    <span className={`invoice-pill invoice-pill--${x.status}`}>{t(STATUS_KEYS[x.status])}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button icon="invoice" variant="primary" onClick={() => setBilling(true)}>{t("invBill")}</Button>
          </>
        )}
      </section>
      {billing && <BillDialog clientId={client.id} onClose={() => setBilling(false)} onCreated={(invoiceId) => navigate(`/invoices/${invoiceId}`)} />}
      {editingProperty && <PropertyDialog key={editingProperty === "new" ? "new" : editingProperty.id} clientId={client.id} property={editingProperty === "new" ? null : editingProperty} onClose={() => setEditingProperty(null)} />}
      {editing && <ClientDialog client={client} onClose={() => setEditing(false)} onDeleted={() => navigate("/clients")} />}
    </div>
  );
}
