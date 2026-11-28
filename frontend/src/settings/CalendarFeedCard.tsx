import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { request } from "../schedule/api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { ErrorNotice } from "../ui/Feedback";
import { useToast } from "../ui/toastContext";

const PATH = "/api/account/calendar-feed";

type FeedInfo = { exists: boolean; created_at: string | null; last_used_at: string | null };
type Confirm = "revoke" | "regenerate" | null;

/** The personal .ics link for Google, Apple or Outlook. The link is shown once, right after it is created. */
export function CalendarFeedCard({ csrfToken }: { csrfToken: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const fieldId = useId();
  const [info, setInfo] = useState<FeedInfo | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const load = useCallback(async () => {
    try { setInfo(await request<FeedInfo>("GET", PATH)); } catch (error) { setFailure(error); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const when = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    try { await work(); setConfirm(null); } catch (error) { setFailure(error); } finally { setBusy(false); }
  }
  const create = () => run(async () => {
    const created = await request<{ url: string; created_at: string }>("POST", PATH, csrfToken);
    setUrl(created.url);
    setInfo({ exists: true, created_at: created.created_at, last_used_at: null });
  });
  const revoke = () => run(async () => {
    await request<void>("DELETE", PATH, csrfToken);
    setUrl(null);
    setInfo({ exists: false, created_at: null, last_used_at: null });
  });
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast(t("feedCopied")); } catch (error) { setFailure(error); }
  }

  return (
    <section className="section settings-card feedcard">
      <header className="feedcard__head">
        <span className="feedcard__icon" aria-hidden="true"><Icon name="calendar" size={22} /></span>
        <div>
          <h2>{t("feedTitle")}</h2>
          <p className="settings-hint">{t("feedHint")}</p>
        </div>
      </header>
      {info && !info.exists && <p className="status feedcard__state" role="status">{t("feedNone")}</p>}
      {info?.exists && info.created_at && (
        <div className="feedcard__state">
          <p className="status ok" role="status">{t("feedActive", { date: when(info.created_at) })}</p>
          {info.last_used_at && <p className="settings-hint">{t("feedLastUsed", { date: when(info.last_used_at) })}</p>}
        </div>
      )}
      {url && (
        <div className="feed-link">
          <label htmlFor={fieldId}>{t("feedLinkLabel")}</label>
          <input id={fieldId} type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <p className="settings-hint">{t("feedShownOnce")}</p>
        </div>
      )}
      {failure !== null && <ErrorNotice error={failure} />}
      {info && (
        <div className="settings-actions">
          {url && <Button variant="primary" onClick={() => void copy()}>{t("feedCopy")}</Button>}
          {!info.exists && <Button variant="primary" busy={busy} onClick={() => void create()}>{t("feedCreate")}</Button>}
          {info.exists && (
            <>
              <Button icon="repeat" busy={busy} onClick={() => setConfirm("regenerate")}>{t("feedRegenerate")}</Button>
              <Button variant="danger" icon="trash" busy={busy} onClick={() => setConfirm("revoke")}>{t("feedRevoke")}</Button>
            </>
          )}
        </div>
      )}
      <p className="feedcard__how">{t("feedHowTo")}</p>
      <p className="feedcard__warn"><Icon name="info" size={18} /><span>{t("feedWarning")}</span></p>
      <Dialog
        open={confirm !== null}
        title={confirm === "revoke" ? t("feedRevoke") : t("feedRegenerate")}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t("cancel")}</Button>
            {confirm === "revoke"
              ? <Button variant="danger" busy={busy} onClick={() => void revoke()}>{t("feedRevoke")}</Button>
              : <Button variant="primary" busy={busy} onClick={() => void create()}>{t("feedRegenerate")}</Button>}
          </>
        }
      >
        <p>{confirm === "revoke" ? t("feedConfirmRevoke") : t("feedConfirmRegenerate")}</p>
      </Dialog>
    </section>
  );
}
