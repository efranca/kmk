import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { displayName, fold } from "../person";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { Button, IconButton } from "../ui/Button";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState("");

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

  // As on Tasks and Users: the search looks through the people and their devices.
  const needle = fold(text);
  const matches = (group: DeviceGroup, s: DeviceSession) => {
    const { browser, os } = parseUserAgent(s.user_agent);
    return fold([group.user.name, group.user.username, browser, os, s.ip, s.city, s.country].filter(Boolean).join(" ")).includes(needle);
  };
  const groups = (query.data ?? [])
    .map((g) => ({ ...g, sessions: needle ? g.sessions.filter((s) => matches(g, s)) : g.sessions }))
    .filter((g) => g.sessions.length > 0);

  return (
    <div className="page page--devices">
      <PageHeader
        title={t("deviceTitle")}
        actions={<IconButton icon="search" label={t("adminSearch")} aria-pressed={searchOpen} onClick={() => { if (searchOpen) setText(""); setSearchOpen(!searchOpen); }} />}
      />
      <p className="status">{t("deviceNote")}</p>
      {searchOpen && (
        <div className="devices-toolbar">
          <label className="devices-toolbar__search">
            <span className="visually-hidden">{t("adminSearch")}</span>
            <input type="search" value={text} autoFocus placeholder={t("adminSearch")} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
      )}
      {query.isPending && <Loading />}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.length === 0 && <EmptyState>{t("deviceNone")}</EmptyState>}
      {query.data && query.data.length > 0 && groups.length === 0 && <EmptyState>{t("adminNoResults")}</EmptyState>}
      <div className="devices">
        {groups.map((group) => {
          const name = displayName(group.user);
          return (
            <section key={group.user.id} className="devices__group" aria-label={name}>
              <header className="devices__who">
                <Avatar person={{ id: group.user.id, name, color: memberColor(group.user.id), avatar_url: group.user.avatar_url }} />
                <span className="devices__name">
                  <strong>{name}</strong> <span className="chip-tag">{t(`role_${group.user.role}`)}</span>
                </span>
                <Button variant="ghost" onClick={() => setPending({ kind: "all", group })}>{t("deviceSignOutAll")}</Button>
              </header>
              <ul className="devices__list">
                {group.sessions.map((s) => {
                  const { browser, os } = parseUserAgent(s.user_agent);
                  return (
                    <li key={s.id} className="device">
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
    </div>
  );
}
