import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { adminList, type AdminResult, type AdminUser, type Session } from "./api";
import AdminInvite from "./AdminInvite";
import AdminUserRow from "./AdminUserRow";

const ERRORS = {
  forbidden: "errForbidden",
  self: "errSelf",
  invalid_state: "errInvalidState",
  last_admin: "errLastAdmin",
  exists: "errExists",
  network: "networkError",
} as const;

export default function AdminPage({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [notice, setNotice] = useState<{ key: string; ok: boolean } | null>(null);

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

  const needle = search.trim().toLowerCase();
  const visible = (users ?? []).filter(
    (u) => (showDeleted || u.status !== "deleted") && (!needle || u.username.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)),
  );

  return (
    <>
      <h1>{t("adminTitle")}</h1>
      {notice && (
        <p className={notice.ok ? "notice" : "error"} role={notice.ok ? "status" : "alert"}>
          {t(notice.key)}
        </p>
      )}
      <AdminInvite csrfToken={session.csrfToken} viewerRole={session.user.role} run={run} />
      <section className="section">
        <div className="form">
          <label>
            {t("adminSearch")}
            <input value={search} onChange={(e) => setSearch(e.target.value)} autoCapitalize="none" />
          </label>
          <label className="check">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
            {t("adminShowDeleted")}
          </label>
        </div>
        {loadFailed && <p className="error" role="alert">{t("networkError")}</p>}
        <div className="user-list">
          {visible.map((u) => (
            <AdminUserRow key={u.id} user={u} csrfToken={session.csrfToken} run={run} />
          ))}
        </div>
      </section>
    </>
  );
}
