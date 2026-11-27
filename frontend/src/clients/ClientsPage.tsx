import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRoute } from "../route";
import { IconButton } from "../ui/Button";
import { EmptyArt } from "../ui/EmptyArt";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { matchesSearch } from "../tasks/search";
import { ClientDialog, KIND_KEYS } from "./ClientDialog";
import { useClients } from "./hooks";

/** The clients: found by name, contact, email, phone or address. Administrators add them. */
export function ClientsPage() {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const { data, isPending, isError, error, refetch } = useClients();
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const clients = data ?? [];
  const searching = text.trim().length > 0;
  const visible = searching ? clients.filter((c) => matchesSearch(text, c.name, c.contact_name, c.email, c.phone, c.address, c.city)) : clients;

  return (
    <div className="page page--clients">
      <PageHeader
        title={t("clientsTitle")}
        actions={
          <>
            <IconButton icon="search" label={t("clientSearchLabel")} aria-pressed={searchOpen} onClick={() => { if (searchOpen) setText(""); setSearchOpen(!searchOpen); }} />
            <IconButton icon="plus" variant="primary" label={t("clientNew")} onClick={() => setAdding(true)} />
          </>
        }
      />
      {searchOpen && (
        <label className="tasks-toolbar__search">
          <span className="visually-hidden">{t("clientSearchLabel")}</span>
          <input type="search" value={text} autoFocus placeholder={t("clientSearchPlaceholder")} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      {isPending ? <Loading />
        : isError ? <ErrorNotice error={error} onRetry={() => void refetch()} />
        : clients.length === 0 ? <EmptyArt art="tasks" title={t("clientEmpty")} hint={t("clientEmptyHint")} />
        : visible.length === 0 ? <EmptyState>{t("clientNoResults", { q: text.trim() })}</EmptyState>
        : (
          <ul className="clients">
            {visible.map((c) => (
              <li key={c.id}>
                <button type="button" className="client" onClick={() => navigate(`/clients/${c.id}`)}>
                  <strong>{c.name}</strong>
                  <span className="chip-tag">{t(KIND_KEYS[c.kind])}</span>
                  <span className="client__facts">
                    {[c.contact_name, c.phone, c.city].filter(Boolean).map((x) => <span key={x}>{x}</span>)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {adding && <ClientDialog client={null} onClose={() => setAdding(false)} onSaved={(c) => navigate(`/clients/${c.id}`)} />}
    </div>
  );
}
