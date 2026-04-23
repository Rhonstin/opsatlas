import { ProjectsClient } from '@google-cloud/resource-manager';

export interface GcpProject {
  projectId: string;
  name: string;
  state: string;
}

/**
 * Discover GCP projects accessible to the service account.
 * Uses searchProjects which returns projects the caller has at least
 * one IAM permission on — works without org-level list permission.
 */
export async function discoverGcpProjects(
  credentials: Record<string, unknown>,
): Promise<GcpProject[]> {
  const client = new ProjectsClient({ credentials });
  const projects: GcpProject[] = [];

  for await (const p of client.searchProjectsAsync({})) {
    if (p.state !== 'ACTIVE' && p.state !== 1) continue; // 1 = ACTIVE enum value
    projects.push({
      projectId: p.projectId ?? '',
      name: p.displayName ?? p.projectId ?? '',
      state: String(p.state),
    });
  }

  // Always include the project from the service account JSON itself
  // in case searchProjects doesn't return it (narrow IAM scope)
  const saProject = credentials.project_id as string | undefined;
  if (saProject && !projects.find((p) => p.projectId === saProject)) {
    projects.unshift({ projectId: saProject, name: saProject, state: 'ACTIVE' });
  }

  return projects;
}
