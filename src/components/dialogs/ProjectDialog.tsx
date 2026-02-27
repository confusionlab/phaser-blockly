import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { listProjects, loadProject, deleteProject, downloadProject, importProjectFromFile, saveProject } from '@/db/database';
import { useCloudSync } from '@/hooks/useCloudSync';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Download, Trash2, Upload, Plus, FolderOpen } from 'lucide-react';
import type { Project } from '@/types';

interface ProjectDialogProps {
  onClose?: () => void;
  onProjectOpen?: (project: Project) => void;
  mode?: 'dialog' | 'page';
}

interface ProjectListItem {
  id: string;
  name: string;
  updatedAt: Date;
}

export function ProjectDialog({ onClose, onProjectOpen, mode = 'dialog' }: ProjectDialogProps) {
  const { project: currentProject, newProject, openProject } = useProjectStore();
  const { selectScene } = useEditorStore();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [tab, setTab] = useState<string>(currentProject ? 'open' : 'new');
  const [showCreateForm, setShowCreateForm] = useState(mode === 'page');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cloud sync hook
  const { syncAllFromCloud, deleteProjectFromCloud, cloudProjects } = useCloudSync({ syncOnMount: false });

  const loadProjectsList = useCallback(async () => {
    const list = await listProjects();
    setProjects(list);
  }, []);

  // Cloud is the source of truth on homepage:
  // pull all cloud projects to local cache and prune local-only records.
  useEffect(() => {
    const syncAndLoad = async () => {
      if (cloudProjects === undefined) {
        return;
      }

      setSyncing(true);
      try {
        await syncAllFromCloud({ pruneLocal: mode === 'page' });
      } finally {
        setSyncing(false);
        await loadProjectsList();
      }
    };

    void syncAndLoad();
  }, [cloudProjects, mode, syncAllFromCloud, loadProjectsList]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    newProject(newProjectName.trim());
    const createdProject = useProjectStore.getState().project;
    if (createdProject) {
      await saveProject(createdProject);

      if (createdProject.scenes.length > 0) {
        selectScene(createdProject.scenes[0].id, { recordHistory: false });
      }
      if (onProjectOpen) {
        onProjectOpen(createdProject);
      } else {
        onClose?.();
      }
      setShowCreateForm(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setLoading(true);
    try {
      const project = await loadProject(projectId);
      if (project) {
        openProject(project);
        if (project.scenes.length > 0) {
          selectScene(project.scenes[0].id, { recordHistory: false });
        }
        if (onProjectOpen) {
          onProjectOpen(project);
        } else {
          onClose?.();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project?')) {
      const deletedInCloud = await deleteProjectFromCloud(projectId);
      if (!deletedInCloud) {
        await syncAllFromCloud({ pruneLocal: mode === 'page' });
        await loadProjectsList();
        return;
      }

      await deleteProject(projectId);
      await syncAllFromCloud({ pruneLocal: mode === 'page' });
      await loadProjectsList();
    }
  };

  const handleExportProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const project = await loadProject(projectId);
    if (project) {
      downloadProject(project);
    }
  };

  const handleImportFile = async (file: File) => {
    setLoading(true);
    setImportError(null);
    try {
      const project = await importProjectFromFile(file);
      openProject(project);
      if (project.scenes.length > 0) {
        selectScene(project.scenes[0].id, { recordHistory: false });
      }
      loadProjectsList();
      if (onProjectOpen) {
        onProjectOpen(project);
      } else {
        onClose?.();
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to import project');
    } finally {
      setLoading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImportFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
      handleImportFile(file);
    } else {
      setImportError('Please drop a .json file');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(date));
  };

  const projectList = (
    <div className="space-y-2 overflow-y-auto">
      {projects.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No projects yet</p>
          <p className="text-sm mt-1">Create your first project to get started!</p>
        </div>
      ) : (
        projects.map(proj => (
          <Card
            key={proj.id}
            onClick={() => handleOpenProject(proj.id)}
            className={`group flex items-center justify-between p-4 cursor-pointer transition-colors hover:bg-accent ${
              currentProject?.id === proj.id
                ? 'border-primary bg-primary/5'
                : ''
            }`}
          >
            <div>
              <h3 className="font-medium">{proj.name}</h3>
              <p className="text-sm text-muted-foreground">
                Updated {formatDate(proj.updatedAt)}
              </p>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => handleExportProject(proj.id, e)}
                title="Export project"
              >
                <Download className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => handleDeleteProject(proj.id, e)}
                title="Delete project"
                className="hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );

  if (mode === 'page') {
    return (
      <div className="relative flex-1 overflow-hidden bg-background">
        <div className="mx-auto max-w-5xl h-full px-6 py-6 flex flex-col gap-4">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            accept=".json"
            className="hidden"
          />

          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Projects</h1>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowCreateForm(value => !value)}>
                <Plus className="size-4" />
                New
              </Button>
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" />
                Import
              </Button>
            </div>
          </div>

          {showCreateForm && (
            <Card className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                  placeholder="My Awesome Game"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Button onClick={handleCreateProject} disabled={!newProjectName.trim()}>
                    <Plus className="size-4" />
                    Create
                  </Button>
                  <Button variant="ghost" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <div className="flex-1 overflow-auto rounded-lg border p-3" onDrop={handleDrop} onDragOver={handleDragOver}>
            {projectList}
          </div>

          {importError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              {importError}
            </div>
          )}

          {(loading || syncing) && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
              <div className="text-muted-foreground">
                {syncing ? 'Syncing from cloud...' : 'Loading...'}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && currentProject && onClose?.()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!!currentProject}>
        <DialogHeader>
          <DialogTitle>Projects</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="new" className="flex-1">
              <Plus className="size-4" />
              New
            </TabsTrigger>
            <TabsTrigger value="open" className="flex-1">
              <FolderOpen className="size-4" />
              Open
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1">
              <Upload className="size-4" />
              Import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Name</label>
              <Input
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                placeholder="My Awesome Game"
                autoFocus
              />
            </div>
            <Button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim()}
              className="w-full"
            >
              <Plus className="size-4" />
              Create Project
            </Button>
          </TabsContent>

          <TabsContent value="open" className="mt-4">
            <div className="max-h-80 overflow-y-auto">
              {projectList}
            </div>
          </TabsContent>

          <TabsContent value="import" className="mt-4 space-y-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              accept=".json"
              className="hidden"
            />
            <Card
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed p-8 text-center cursor-pointer hover:border-primary hover:bg-accent transition-colors"
            >
              <Upload className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">Drop a project file here</p>
              <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
              <p className="text-xs text-muted-foreground mt-3">.pochacoding.json files</p>
            </Card>
            {importError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                {importError}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {(loading || syncing) && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center rounded-lg">
            <div className="text-muted-foreground">
              {syncing ? 'Syncing from cloud...' : 'Loading...'}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
