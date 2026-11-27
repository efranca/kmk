import { useTranslation } from "react-i18next";

import { useClients } from "../clients/hooks";
import { ErrorNotice, Loading } from "../ui/Feedback";
import { DashCard } from "./DashCard";

const MAX = 6;

/** For Staff: the clients they are scheduled for, with where to go and how to reach them. */
export function ClientsCard({ onOpenClients, onOpenClient }: { onOpenClients: () => void; onOpenClient: (id: number) => void }) {
  const { t } = useTranslation();
  const query = useClients();
  const clients = query.data ?? [];
  const state = query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} onRetry={() => void query.refetch()} /> : null;
  return (
    <DashCard title={t("dashMyClients")} href="/clients" onOpen={onOpenClients} state={state} empty={clients.length === 0} emptyText={t("dashMyClientsEmpty")}>
      <ul className="dash__list">
        {clients.slice(0, MAX).map((c) => (
          <li key={c.id}>
            <button type="button" className="dash__row dash__row--client" onClick={() => onOpenClient(c.id)}>
              <span className="dash__title">{c.name}</span>
              <span className="dash__client-facts">
                {[[c.address, c.city].filter(Boolean).join(", "), c.phone, c.email].filter(Boolean).map((x) => <span key={x}>{x}</span>)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {clients.length > MAX && <button type="button" className="dash__more" onClick={onOpenClients}>{t("schMore", { n: clients.length - MAX })}</button>}
    </DashCard>
  );
}
