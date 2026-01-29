import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { listProjects, loadProject, deleteProject, downloadProject, importProjectFromFile } from '../../db/database';

interface ProjectDialogProps {
  onClose: () => void;
}

interface ProjectListItem {
  id: string;
  name: string;
  updatedAt: Date;
}

export function ProjectDialog({ onClose }: ProjectDialogProps) {
  const { project: currentProject, newProject, openProject } = useProjectStore();
  const { selectScene } = useEditorStore();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [tab, setTab] = useState<'new' | 'open' | 'import'>(currentProject ? 'open' : 'new');
  const [loading, setLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load projects list
  useEffect(() => {
    loadProjectsList();
  }, []);

  const loadProjectsList = async () => {
    const list = await listProjects();
    setProjects(list);
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    newProject(newProjectName.trim());
    // Get the newly created project and select its first scene
    const createdProject = useProjectStore.getState().project;
    if (createdProject && createdProject.scenes.length > 0) {
      selectScene(createdProject.scenes[0].id);
    }
    onClose();
  };

  const handleOpenProject = async (projectId: string) => {
    setLoading(true);
    try {
      const project = await loadProject(projectId);
      if (project) {
        openProject(project);
        if (project.scenes.length > 0) {
          selectScene(project.scenes[0].id);
        }
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project?')) {
      await deleteProject(projectId);
      loadProjectsList();
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
        selectScene(project.scenes[0].id);
      }
      loadProjectsList();
      onClose();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold">Projects</h2>
          {currentProject && (
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
            >
              ×
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab('new')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === 'new'
                ? 'text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            New Project
          </button>
          <button
            onClick={() => setTab('open')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === 'open'
                ? 'text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Open Project
          </button>
          <button
            onClick={() => setTab('import')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === 'import'
                ? 'text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Import
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {tab === 'new' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                  placeholder="My Awesome Game"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                  autoFocus
                />
              </div>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="w-full py-3 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:bg-[var(--color-primary-dark)] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Create Project
              </button>
            </div>
          ) : tab === 'open' ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {projects.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No projects yet</p>
                  <p className="text-sm mt-1">Create your first project to get started!</p>
                </div>
              ) : (
                projects.map(proj => (
                  <div
                    key={proj.id}
                    onClick={() => handleOpenProject(proj.id)}
                    className={`group flex items-center justify-between p-4 rounded-lg cursor-pointer transition-colors ${
                      currentProject?.id === proj.id
                        ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]'
                        : 'bg-gray-50 hover:bg-gray-100 border border-transparent'
                    }`}
                  >
                    <div>
                      <h3 className="font-medium text-gray-900">{proj.name}</h3>
                      <p className="text-sm text-gray-500">
                        Updated {formatDate(proj.updatedAt)}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => handleExportProject(proj.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-blue-500 transition-all"
                        title="Export project"
                      >
                        📤
                      </button>
                      <button
                        onClick={(e) => handleDeleteProject(proj.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500 transition-all"
                        title="Delete project"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInputChange}
                accept=".json"
                className="hidden"
              />
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-[var(--color-primary)] hover:bg-gray-50 transition-colors"
              >
                <div className="text-4xl mb-3">📁</div>
                <p className="text-gray-700 font-medium">Drop a project file here</p>
                <p className="text-sm text-gray-500 mt-1">or click to browse</p>
                <p className="text-xs text-gray-400 mt-3">.pochacoding.json files</p>
              </div>
              {importError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {importError}
                </div>
              )}
            </div>
          )}
        </div>

        {loading && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
            <div className="text-gray-600">Loading...</div>
          </div>
        )}
      </div>
    </div>
  );
}
