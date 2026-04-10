import type { PropsWithChildren, ReactNode } from 'react';

export interface AppShellProps extends PropsWithChildren {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}

/**
 * Shared shell component for side-panel and management surfaces.
 */
export function AppShell({
  title,
  subtitle,
  actions,
  children
}: AppShellProps) {
  return (
    <div className="rf-shell">
      <header className="rf-shell__header">
        <div>
          <p className="rf-shell__eyebrow">RoutineFlow</p>
          <h1 className="rf-shell__title">{title}</h1>
          <p className="rf-shell__subtitle">{subtitle}</p>
        </div>
        {actions ? <div className="rf-shell__actions">{actions}</div> : null}
      </header>
      <main className="rf-shell__body">{children}</main>
    </div>
  );
}
