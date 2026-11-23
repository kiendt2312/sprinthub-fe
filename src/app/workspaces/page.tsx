'use client';

import Link from 'next/link';
import { DirectoryCreate } from '@/components/directory-create';
import { AppShell, ResourceError, ResourcePending, ShellIcon } from '@/components/shell';
import { useSessionResource } from '@/components/use-session-resource';
import { api } from '@/lib/api';

async function loadWorkspaces() {
  const [profile, workspaces] = await Promise.all([api.me(), api.workspaces()]);
  return { profile, workspaces };
}

export default function WorkspacesPage() {
  const { state, retry } = useSessionResource(loadWorkspaces);
  if (state.kind === 'pending') return <ResourcePending label="Loading workspaces…" />;
  if (state.kind === 'error') return <ResourceError message={state.message} retry={retry} />;

  return (
    <AppShell profile={state.data.profile}>
      <section className="sh-directory">
        <DirectoryCreate title="Workspaces" locale={state.data.profile.locale} target={{ kind: 'workspace' }} />
        {state.data.workspaces.length ? (
          <ul className="sh-directory-list">
            {state.data.workspaces.map(workspace => (
              <li key={workspace.id}>
                <Link href={`/workspaces/${workspace.id}`} aria-label={workspace.name}>
                  <span className="sh-directory-icon"><ShellIcon name="grid" size={20} /></span>
                  <span className="sh-directory-item"><strong>{workspace.name}</strong></span>
                  <ShellIcon name="arrow" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sh-empty">You are not a member of any workspace.</p>
        )}
      </section>
    </AppShell>
  );
}
