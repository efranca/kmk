import { useTranslation } from "react-i18next";

import { Dialog } from "../ui/Dialog";
import { Icon, type IconName } from "../ui/Icon";

export type MoreItem = { to: string; label: string; icon: IconName; current: boolean };

/** The pages that do not fit the phone's bottom bar, as a sheet of links; following one closes it. */
export default function MoreSheet({ open, items, onClose, onNavigate }: { open: boolean; items: MoreItem[]; onClose: () => void; onNavigate: (path: string) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} title={t("navMoreTitle")} onClose={onClose}>
      <ul className="more-sheet">
        {items.map((item) => (
          <li key={item.to}>
            <a
              href={item.to}
              className="more-sheet__link"
              aria-current={item.current ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                onClose();
                onNavigate(item.to);
              }}
            >
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
