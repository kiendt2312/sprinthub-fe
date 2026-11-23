'use client';

import Link from 'next/link';
import { use, useCallback } from 'react';
import { DirectoryCreate } from '@/components/directory-create';
import { AppShell, ResourceError, ResourcePending, ShellIcon } from '@/components/shell';
import { useSessionResource } from '@/components/use-session-resource';
import { api } from '@/lib/api';

export default function WorkspaceProjectsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const load = useCallback(async () => {
    const [profile, workspace, projects] = await Promise.all([
      api.me(), api.workspace(workspaceId), api.projects(workspaceId),
    ]);
    return { profile, workspace, projects };
  }, [workspaceId]);

  const { state, retry } = useSessionResource(load);
  if (state.kind === 'pending') return <ResourcePending label="Loading projects…" />;
  if (state.kind === 'error') return <ResourceError message={state.message} retry={retry} />;
  const { profile, workspace, projects } = state.data;
  const canCreateProject = workspace.role === 'OWNER' || workspace.role === 'ADMIN';

  return (
    <AppShell profile={profile} workspace={workspace}>
      <section className="sh-directory">
        {canCreateProject
          ? <DirectoryCreate title="Projects" locale={profile.locale} target={{ kind: 'project', workspaceId }} />
          : <h1>Projects</h1>}
        {projects.length ? (
          <ul className="sh-directory-list">
            {projects.map(project => (
              <li key={project.id}>
                <Link href={`/projects/${project.id}/board`} aria-label={project.name}>
                  <span className="sh-directory-icon"><ShellIcon name="folder" size={20} /></span>
                  <span className="sh-directory-item">
                    <strong>{project.name}</strong>
                    <small>{project.key}</small>
                  </span>
                  <ShellIcon name="arrow" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sh-empty">This workspace has no active projects.</p>
        )}
      </section>
    </AppShell>
  );
}
