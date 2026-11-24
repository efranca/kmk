import type { ReactNode } from "react";

/** Every page's title row: the title on the left, the page's actions (search, the primary plus...) on the right. */
export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page__header">
      <h1>{title}</h1>
      {actions && <div className="page__actions">{actions}</div>}
    </header>
  );
}
