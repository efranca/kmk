import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { Button, IconButton } from "../ui/Button";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import { ClientDialog, KIND_KEYS } from "./ClientDialog";
import { useClient } from "./hooks";

type Tab = "details" | "documents" | "tasks" | "events" | "quotes";
const TABS: Tab[] = ["details", "documents", "tasks", "events", "quotes"];
const TAB_KEYS: Record<Tab, string> = { details: "clientTabDetails", documents: "clientTabDocuments", tasks: "clientTabTasks", events: "clientTabEvents", quotes: "clientTabQuotes" };

/** One client: the details, and what is linked to them (documents, tasks, Agenda items, quotes). */
export function ClientPage({ id }: { id: number }) {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const { data: client, isPending, isError, error, refetch } = useClient(id);
  const [tab, setTab] = useState<Tab>("details");
  const [editing, setEditing] = useState(false);

  const back = <IconButton icon="chev-left" label={t("clientsTitle")} onClick={() => navigate("/clients")} />;
  if (isPending) return <div className="page"><Loading /></div>;
  if (isError || !client) return <div className="page"><div className="clientpage__top">{back}</div><ErrorNotice error={error} onRetry={() => void refetch()} /></div>;

  const counts: Record<Tab, number> = { details: 0, documents: client.documents.length, tasks: client.tasks.length, events: client.events.length, quotes: client.quotes.length };
  const facts: [string, string | null, string?][] = [
    [t("clientFieldKind"), t(KIND_KEYS[client.kind])],
    [t("clientFieldContact"), client.contact_name],
    [t("clientFieldEmail"), client.email, client.email ? `mailto:${client.email}` : undefined],
    [t("clientFieldPhone"), client.phone, client.phone ? `tel:${client.phone.replace(/[^\d+]/g, "")}` : undefined],
    [t("clientFieldAddress"), [client.address, client.city].filter(Boolean).join(", ") || null],
    [t("clientFieldNotes"), client.notes],
  ];
  const empty = <p className="status">{t("clientNothingLinked")}</p>;

  return (
    <div className="page page--client">
      <PageHeader title={<span className="clientpage__top">{back}{client.name}</span>} actions={<Button icon="pencil" onClick={() => setEditing(true)}>{t("clientEdit")}</Button>} />
      <Segmented label={t("clientTabs")} value={tab} onChange={setTab} options={TABS.map((x) => ({ value: x, label: counts[x] ? `${t(TAB_KEYS[x])} ${counts[x]}` : t(TAB_KEYS[x]) }))} />
      <section className="section client-card">
        {tab === "details" && (
          <dl className="client-facts">
            {facts.filter(([, v]) => v).map(([label, value, href]) => (
              <div key={label} style={{ display: "contents" }}><dt>{label}</dt><dd>{href ? <a href={href}>{value}</a> : value}</dd></div>
            ))}
          </dl>
        )}
        {tab === "documents" && (client.documents.length === 0 ? empty : (
          <ul className="client-links">{client.documents.map((d) => <li key={d.id}><a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer">{d.title}</a></li>)}</ul>
        ))}
        {tab === "tasks" && (client.tasks.length === 0 ? empty : (
          <ul className="client-links">{client.tasks.map((x) => <li key={x.id}><button type="button" onClick={() => navigate("/tasks")}>{x.title}</button><small>{x.due_date ?? ""}</small></li>)}</ul>
        ))}
        {tab === "events" && (client.events.length === 0 ? empty : (
          <ul className="client-links">{client.events.map((x) => <li key={x.id}><button type="button" onClick={() => navigate(`/schedule?view=day&date=${x.start_date}`)}>{x.title}</button><small>{x.start_date} {x.start_time ?? ""}</small></li>)}</ul>
        ))}
        {tab === "quotes" && (client.quotes.length === 0 ? empty : (
          <ul className="client-links">{client.quotes.map((x) => <li key={x.id}><button type="button" onClick={() => navigate(`/quotes/${x.id}`)}>{x.reference}</button><small>{x.submitted_at?.slice(0, 10) ?? ""}</small></li>)}</ul>
        ))}
      </section>
      {editing && <ClientDialog client={client} onClose={() => setEditing(false)} onDeleted={() => navigate("/clients")} />}
    </div>
  );
}
