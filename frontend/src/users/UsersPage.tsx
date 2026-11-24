import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { adminList, type AdminResult, type AdminUser, type Session } from "../api";
import { fold } from "../person";
import { IconButton } from "../ui/Button";
import { EmptyState } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Toggle } from "../ui/Toggle";
import InviteDialog from "./InviteDialog";
import UserDialog from "./UserDialog";
import UserRow from "./UserRow";

const ERRORS = {
  forbidden: "errForbidden",
  self: "errSelf",
  invalid_state: "errInvalidState",
  last_admin: "errLastAdmin",
  exists: "errExists",
  invalid: "errInvalidInput",
  network: "networkError",
} as const;

/** The people of the team: a list like Tasks, a plus to invite someone, and a dialog with the actions for one person. */
export default function UsersPage({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [notice, setNotice] = useState<{ key: string; ok: boolean } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const list = await adminList();
    if (list) {
      setUsers(list);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(p: Promise<AdminResult>, okKey = "adminDone"): Promise<boolean> {
    const result = await p;
    if (result.ok) {
      setNotice({ key: okKey, ok: true });
      await load();
      return true;
    }
    setNotice({ key: ERRORS[result.reason], ok: false });
    return false;
  }

  const needle = fold(search);
  const visible = (users ?? []).filter(
    (u) => (showDeleted || u.status !== "deleted") && (!needle || fold(u.username).includes(needle) || fold(u.email).includes(needle) || fold(u.name ?? "").includes(needle)),
  );
  const open = users?.find((u) => u.id === openId) ?? null;
  const dialogOpen = inviting || open !== null;

  // A message is shown where the person is looking: inside the dialog while one is open, otherwise on the page.
  const message = notice && (
    <p className={notice.ok ? "notice" : "error"} role={notice.ok ? "status" : "alert"}>
      {t(notice.key)}
    </p>
  );
  const close = () => {
    setInviting(false);
    setOpenId(null);
  };

  return (
    <div className="page page--users">
      <PageHeader
        title={t("adminTitle")}
        actions={
          <>
            <IconButton icon="search" label={t("adminSearch")} aria-pressed={searchOpen} onClick={() => { if (searchOpen) setSearch(""); setSearchOpen(!searchOpen); }} />
            <IconButton icon="plus" variant="primary" label={t("adminInviteTitle")} onClick={() => { setNotice(null); setInviting(true); }} />
          </>
        }
      />
      {!dialogOpen && message}
      <div className="users-toolbar">
        {searchOpen && (
          <label className="users-toolbar__search">
            <span className="visually-hidden">{t("adminSearch")}</span>
            <input type="search" value={search} autoFocus autoCapitalize="none" placeholder={t("adminSearch")} onChange={(e) => setSearch(e.target.value)} />
          </label>
        )}
        <Toggle label={t("adminShowDeleted")} checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
      </div>
      {loadFailed && <p className="error" role="alert">{t("networkError")}</p>}
      {users && visible.length === 0 && <EmptyState>{t("adminNoResults")}</EmptyState>}
      <ul className="users">
        {visible.map((u) => (
          <UserRow key={u.id} user={u} onOpen={() => { setNotice(null); setOpenId(u.id); }} />
        ))}
      </ul>
      {inviting && <InviteDialog csrfToken={session.csrfToken} viewerRole={session.user.role} run={run} notice={message} onClose={close} />}
      {open && <UserDialog key={open.id} user={open} csrfToken={session.csrfToken} run={run} notice={message} onClose={close} />}
    </div>
  );
}
