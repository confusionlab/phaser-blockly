import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { ProjectExplorerPage } from '@/components/home/ProjectExplorerPage';
import { useProjectStore } from '@/store/projectStore';

export function ProjectExplorerLayout() {
  const navigate = useNavigate();
  const project = useProjectStore((state) => state.project);

  useEffect(() => {
    if (!project) {
      return;
    }

    navigate(`/project/${project.id}`, { replace: true });
  }, [navigate, project]);

  const handleProjectOpen = useCallback((openedProject: { id: string }) => {
    navigate(`/project/${openedProject.id}`);
  }, [navigate]);

  if (project) {
    return null;
  }

  return <ProjectExplorerPage onProjectOpen={handleProjectOpen} />;
}
