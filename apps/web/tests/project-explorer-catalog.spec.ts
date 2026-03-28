import { expect, test } from '@playwright/test';

import { buildProjectExplorerCatalogSnapshot } from '../src/lib/projectExplorerCatalog';
import { createDefaultProjectExplorerState } from '../src/lib/projectExplorer';

test.describe('project explorer catalog', () => {
  test('shows only cloud projects when an authenticated cloud snapshot exists', () => {
    const now = 1_700_000_000_000;
    const snapshot = buildProjectExplorerCatalogSnapshot({
      cloudExplorerState: createDefaultProjectExplorerState(now),
      cloudProjects: [
        {
          id: 'cloud-project',
          name: 'Cloud Project',
          createdAt: now,
          updatedAt: now,
        },
      ],
      hasCloudSnapshot: true,
      localExplorerState: createDefaultProjectExplorerState(now),
      localProjects: [
        {
          id: 'cloud-project',
          name: 'Cloud Project (Cached)',
          createdAt: now,
          updatedAt: now,
          storageOrigin: 'cloudCache',
          currentThumbnailVisualSignature: null,
        },
        {
          id: 'local-draft',
          name: 'Local Draft',
          createdAt: now,
          updatedAt: now + 1_000,
          storageOrigin: 'localDraft',
          currentThumbnailVisualSignature: null,
        },
        {
          id: 'cloud-project-conflict-deadbeef',
          name: 'Cloud Project (Conflict)',
          createdAt: now,
          updatedAt: now + 2_000,
          storageOrigin: 'conflictCopy',
          currentThumbnailVisualSignature: null,
        },
      ],
    });

    expect(snapshot.projects.map((project) => project.id)).toEqual(['cloud-project']);
  });

  test('shows local projects when no cloud snapshot is available', () => {
    const now = 1_700_000_000_000;
    const snapshot = buildProjectExplorerCatalogSnapshot({
      cloudExplorerState: null,
      cloudProjects: [],
      hasCloudSnapshot: false,
      localExplorerState: createDefaultProjectExplorerState(now),
      localProjects: [
        {
          id: 'local-draft',
          name: 'Local Draft',
          createdAt: now,
          updatedAt: now,
          storageOrigin: 'localDraft',
          currentThumbnailVisualSignature: null,
        },
      ],
    });

    expect(snapshot.projects.map((project) => project.id)).toEqual(['local-draft']);
  });
});
