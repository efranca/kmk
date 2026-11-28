import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ApiFailure, request, upload } from "./schedule/api";
import { Avatar, type Person } from "./ui/Avatar";
import { Button } from "./ui/Button";
import { AVATAR_ACCEPT, prepareAvatar } from "./ui/prepareAvatar";

/**
 * Your picture, with Change and Remove. The browser crops and shrinks the chosen file; it is sent at once.
 * `onChanged` runs after the server accepted a change, so the page can show the new picture everywhere.
 */
export default function AvatarPicker({ person, csrfToken, onChanged, heading }: { person: Person; csrfToken: string; onChanged: () => void; /** Shown beside the picture, above the buttons (the name and role on the Account page). */ heading?: ReactNode }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      const invalid = (e instanceof Error && e.message === "invalid_image") || (e instanceof ApiFailure && e.code === "invalid_image");
      setError(t(invalid ? "avatarInvalid" : "networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="avatar-picker">
      <Avatar person={person} size="xl" labelled />
      <div className="avatar-picker__side">
        {heading}
        <div className="avatar-picker__actions">
        <Button icon="upload" busy={busy} onClick={() => input.current?.click()}>
          {t(person.avatar_url ? "avatarChange" : "avatarChoose")}
        </Button>
        {person.avatar_url && (
          <Button variant="ghost" disabled={busy} onClick={() => void run(() => request("DELETE", "/api/me/avatar", csrfToken))}>
            {t("avatarRemove")}
          </Button>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={AVATAR_ACCEPT}
        hidden
        aria-label={t("avatarChoose")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void run(async () => upload("PUT", "/api/me/avatar", csrfToken, await prepareAvatar(file)));
        }}
      />
    </div>
  );
}
