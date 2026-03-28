import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { ProjectExplorerPage } from '@/components/home/ProjectExplorerPage';

export function ProjectExplorerLayout({
  authBootstrapState = 'steady',
}: {
  authBootstrapState?: 'steady' | 'reconnecting';
}) {
  const navigate = useNavigate();

  const handleProjectOpen = useCallback((openedProject: { id: string }) => {
    navigate(`/project/${openedProject.id}`);
  }, [navigate]);

  return (
    <ProjectExplorerPage
      authBootstrapState={authBootstrapState}
      onProjectOpen={handleProjectOpen}
    />
  );
}
