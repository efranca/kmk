import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { displayName } from "../person";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { memberColor } from "../ui/memberColor";
import { endAllDevices, endDevice, listDevices, type DeviceGroup, type DeviceSession } from "./api";
import { flagEmoji, isPrivateAddress, parseUserAgent, relativeTime } from "./devices";

type Pending = { kind: "one"; session: DeviceSession } | { kind: "all"; group: DeviceGroup };

/** Who is signed in, where: every active session by person, for the super admin to end. Location is approximate. */
export default function DevicesPage() {
  const { t, i18n } = useTranslation();
  const { csrfToken, user: me } = useSession();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["devices"], queryFn: listDevices });
  const [pending, setPending] = useState<Pending | null>(null);

  const end = useMutation({
    mutationFn: async (p: Pending) => (p.kind === "one" ? endDevice(p.session.id, csrfToken) : endAllDevices(p.group.user.id, csrfToken)),
    onSuccess: (_data, p) => {
      setPending(null);
      const endedOwn = p.kind === "one" ? p.session.current : p.group.user.id === me.id;
      if (endedOwn) window.location.reload(); // this session is gone: the page returns to the sign-in form
      else void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  const now = new Date();
  const place = (s: DeviceSession) => {
    if (s.country) return `${flagEmoji(s.country)} ${s.city ? `${s.city}, ` : ""}${s.country}`.trim();
    return isPrivateAddress(s.ip) ? t("deviceLocalNetwork") : t("deviceLocationUnknown");
  };

  return (
    <>
      <PageHeader title={t("deviceTitle")} />
      <p className="status">{t("deviceNote")}</p>
      {query.isPending && <Loading />}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.length === 0 && <EmptyState>{t("deviceNone")}</EmptyState>}
      <div className="devices">
        {query.data?.map((group) => {
          const name = displayName(group.user);
          return (
            <section key={group.user.id} className="devices__group" aria-label={name}>
              <header className="devices__who">
                <Avatar person={{ id: group.user.id, name, color: memberColor(group.user.id), avatar_url: group.user.avatar_url }} />
                <span>
                  <strong>{name}</strong> <span className="chip-tag">{t(`role_${group.user.role}`)}</span>
                </span>
                <Button variant="ghost" onClick={() => setPending({ kind: "all", group })}>{t("deviceSignOutAll")}</Button>
              </header>
              <ul className="devices__list">
                {group.sessions.map((s) => {
                  const { browser, os } = parseUserAgent(s.user_agent);
                  return (
                    <li key={s.id} className="devices__row">
                      <div className="devices__main">
                        <strong>{browser || os ? [browser, os].filter(Boolean).join(" · ") : t("deviceUnknownDevice")}</strong>
                        {s.current && <span className="chip-tag">{t("deviceThisDevice")}</span>}
                        <span className="muted">
                          {t("deviceLastSeen", { when: relativeTime(s.last_seen_at, now, i18n.language) })} · {s.ip ?? "—"}
                        </span>
                        <span className="muted">{place(s)}</span>
                        <span className="muted">{t("deviceStarted", { when: new Date(s.created_at).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }) })}</span>
                      </div>
                      <Button variant="ghost" onClick={() => setPending({ kind: "one", session: s })}>{t("deviceSignOut")}</Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <Dialog
        open={pending !== null}
        title={pending?.kind === "all" ? t("deviceSignOutAll") : t("deviceSignOut")}
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>{t("cancel")}</Button>
            <Button variant="danger" busy={end.isPending} onClick={() => pending && end.mutate(pending)}>{t("confirm")}</Button>
          </>
        }
      >
        <p>{pending?.kind === "all" ? t("deviceConfirmAll", { name: displayName(pending.group.user) }) : t("deviceConfirmOne")}</p>
        {end.isError && <p className="error" role="alert">{t("networkError")}</p>}
      </Dialog>
    </>
  );
}
