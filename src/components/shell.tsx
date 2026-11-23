'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api, errorMessage, type Profile, type Project, type Workspace } from '@/lib/api';

const glyphs = {
  board: 'M3 5h18v14H3z M9 5v14m6-14v14',
  folder: 'M3 7h7l2 2h9v10H3z M3 7V5h7l2 2h7',
  grid: 'M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v6H3zM14 15h7v6h-7z',
  logout: 'M11 4H5v16h6m3-4 4-4-4-4m-5 4h10',
  arrow: 'm9 18 6-6-6-6',
};

export function ShellIcon({ name, size = 16 }: { name: keyof typeof glyphs; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={glyphs[name]} />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/workspaces" className="sh-brand">
      <span className="sh-brand-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M4 4h12l-3 4H4zm0 6h9l-3 4H4zm0 6h5l-2 2H4z" />
        </svg>
      </span>
      SprintHub
    </Link>
  );
}

function Account({ profile }: { profile: Profile }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    setSigningOut(true);
    setError('');
    try {
      await api.logout();
      window.location.replace('/login');
    } catch (failure) {
      setError(errorMessage(failure));
      setSigningOut(false);
    }
  }

  return (
    <div className="sh-account">
      {error && <p className="sh-account-error" role="alert">{error}</p>}
      <div className="sh-account-row">
        <span className="sh-avatar" aria-hidden="true">
          {profile.displayName.trim().split(/\s+/u).slice(0, 2).map(word => word[0]).join('').toUpperCase()}
        </span>
        <span className="sh-account-name">{profile.displayName}</span>
        <button aria-label="Sign out" title="Sign out" className="sh-icon-button"
          disabled={signingOut} onClick={signOut}>
          <ShellIcon name="logout" />
        </button>
      </div>
    </div>
  );
}

export function AppShell({ profile, workspace, project, children }: {
  profile: Profile;
  workspace?: Workspace;
  project?: Project;
  children: ReactNode;
}) {
  const boardHref = project ? `/projects/${project.id}/board` : null;
  const projectsHref = workspace ? `/workspaces/${workspace.id}` : null;

  return (
    <div className="sh-shell">
      <aside className="sh-sidebar">
        <Brand />
        {workspace ? (
          <Link href="/workspaces" className="sh-workspace-switcher" aria-label={`Change workspace from ${workspace.name}`}>
            <span className="sh-workspace-icon"><ShellIcon name="grid" /></span>
            <span className="sh-workspace-identity">
              <strong>{workspace.name}</strong>
              <small>Workspace</small>
            </span>
            <ShellIcon name="arrow" size={13} />
          </Link>
        ) : null}
        <nav className="sh-menu" aria-label="Workspace">
          <span className="sh-nav-label">Workspace</span>
          <Link href="/workspaces" className={`sh-nav-link${!workspace ? ' sh-nav-active' : ''}`}>
            <ShellIcon name="grid" />Workspaces
          </Link>
          {projectsHref && <Link href={projectsHref} className={`sh-nav-link${!project ? ' sh-nav-active' : ''}`}>
            <ShellIcon name="folder" />Projects
          </Link>}
          {boardHref && <Link href={boardHref} className="sh-nav-link sh-nav-active">
            <ShellIcon name="board" />Board
          </Link>}
        </nav>
        {project && boardHref && (
          <nav className="sh-menu sh-project-menu" aria-label="Current project">
            <span className="sh-nav-label">Current project</span>
            <Link href={boardHref} className="sh-nav-link"><ShellIcon name="folder" />{project.name}</Link>
          </nav>
        )}
        <Account profile={profile} />
      </aside>
      <div className="sh-main">
        <header className="sh-topbar" aria-label="Breadcrumb">
          {workspace ? (
            <>
              <Link href="/workspaces">{workspace.name}</Link>
              {projectsHref && <><ShellIcon name="arrow" size={12} /><Link href={projectsHref}>Projects</Link></>}
              {project && boardHref && (
                <><ShellIcon name="arrow" size={12} /><Link href={boardHref}>{project.name}</Link></>
              )}
            </>
          ) : <strong>Workspaces</strong>}
        </header>
        <main className="sh-content">{children}</main>
      </div>
    </div>
  );
}

export function ResourcePending({ label }: { label: string }) {
  return <div className="sh-resource" role="status">{label}</div>;
}

export function ResourceError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="sh-resource">
      <p role="alert">{message}</p>
      <button type="button" className="sh-button sh-button-secondary" onClick={retry}>Try again</button>
    </div>
  );
}
