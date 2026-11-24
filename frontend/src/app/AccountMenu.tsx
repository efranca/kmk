import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "../api";
import LanguageSwitcher from "../LanguageSwitcher";
import { displayName } from "../person";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";
import { memberColor } from "../ui/memberColor";

/** Your face at the top right: opens Account, the language and Sign out. */
export default function AccountMenu({
  user,
  csrfToken,
  active,
  onNavigate,
  onLanguageChanged,
  onSignOut,
}: {
  user: User;
  csrfToken: string;
  active: boolean;
  onNavigate: (path: string) => void;
  onLanguageChanged: (user: User) => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const name = displayName(user);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="accountmenu" ref={root}>
      <button
        type="button"
        className="accountmenu__button"
        data-account-menu
        aria-label={t("accountMenu")}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar person={{ id: user.id, name, color: memberColor(user.id) }} size="md" />
        <Icon name="chev-down" size={16} />
      </button>
      {open && (
        <div className="accountmenu__panel" id={panelId}>
          <p className="accountmenu__who">{name}</p>
          <a
            href="/account"
            aria-current={active ? "page" : undefined}
            className="accountmenu__item"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              onNavigate("/account");
            }}
          >
            <Icon name="account" size={18} />
            {t("navAccount")}
          </a>
          <div className="accountmenu__item accountmenu__item--static">
            <LanguageSwitcher csrfToken={csrfToken} onChanged={onLanguageChanged} />
          </div>
          <button type="button" className="accountmenu__item" onClick={onSignOut}>
            <Icon name="logout" size={18} />
            {t("signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
