'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { AppShell, ResourceError, ResourcePending } from './shell';
import { useSessionResource } from './use-session-resource';
import { api, type Profile, type Project } from '@/lib/api';

const ProjectContext = createContext<{ project: Project; profile: Profile } | null>(null);

export function useProjectContext() {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('Project context is unavailable.');
  return context;
}

export function ProjectShell({ projectId, children }: { projectId: string; children: ReactNode }) {
  const load = useCallback(async () => {
    const [project, profile] = await Promise.all([api.project(projectId), api.me()]);
    const workspace = await api.workspace(project.workspaceId);
    return { project, profile, workspace };
  }, [projectId]);
  const { state, retry } = useSessionResource(load);

  if (state.kind === 'pending') return <ResourcePending label="Loading project…" />;
  if (state.kind === 'error') return <ResourceError message={state.message} retry={retry} />;

  const { project, profile, workspace } = state.data;
  return (
    <ProjectContext.Provider value={{ project, profile }}>
      <AppShell workspace={workspace} project={project} profile={profile}>{children}</AppShell>
    </ProjectContext.Provider>
  );
}
