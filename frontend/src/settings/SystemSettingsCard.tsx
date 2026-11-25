import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { request } from "../schedule/api";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { ErrorNotice } from "../ui/Feedback";
import { TextField } from "../ui/Field";
import { useToast } from "../ui/toastContext";

type SystemSettings = { quote_notify_email: string; quote_from: string; quote_reply_to: string; public_phone: string };
const KEY = ["settings", "system"] as const;
const FIELDS = [
  { key: "quote_notify_email", label: "sysNotifyEmail", hint: "sysNotifyEmailHint", type: "email" },
  { key: "quote_from", label: "sysFrom", hint: "sysFromHint", type: "text" },
  { key: "quote_reply_to", label: "sysReplyTo", hint: "sysReplyToHint", type: "email" },
  { key: "public_phone", label: "sysPhone", hint: "sysPhoneHint", type: "tel" },
] as const;

/** Company-wide settings (the super admin only): who is told about a quote, and how replies to customers are sent. */
export function SystemSettingsCard() {
  const { user } = useSession();
  return user.role === "superadmin" ? <Form /> : null;
}

function Form() {
  const { t } = useTranslation();
  const toast = useToast();
  const { csrfToken } = useSession();
  const client = useQueryClient();
  const loaded = useQuery({ queryKey: KEY, queryFn: async () => (await request<{ settings: SystemSettings }>("GET", "/api/settings/system")).settings });
  const [edits, setEdits] = useState<Partial<SystemSettings>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const values = { ...loaded.data, ...edits } as SystemSettings;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const saved = await request<{ settings: SystemSettings }>("PATCH", "/api/settings/system", csrfToken, values);
      client.setQueryData(KEY, saved.settings);
      setEdits({});
      toast(t("sysSaved"));
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section settings-card">
      <h2>{t("sysTitle")}</h2>
      <p className="status">{t("sysIntro")}</p>
      {loaded.isError ? <ErrorNotice error={loaded.error} onRetry={() => void loaded.refetch()} /> : loaded.data && (
        <form className="settings-form" noValidate onSubmit={(e) => void save(e)}>
          {FIELDS.map((f) => (
            <TextField key={f.key} label={t(f.label)} hint={t(f.hint)} type={f.type} maxLength={200} value={values[f.key]} onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })} />
          ))}
          {failure !== null && ((failure as { code?: string }).code === "invalid" ? <p className="notice notice--error" role="alert">{t("sysInvalid")}</p> : <ErrorNotice error={failure} />)}
          <Button variant="primary" type="submit" busy={busy}>{t("save")}</Button>
        </form>
      )}
    </section>
  );
}
