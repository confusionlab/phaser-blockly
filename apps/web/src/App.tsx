import { useEffect, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '@convex-generated/api';
import { SignIn, UserButton, useAuth, useUser } from '@clerk/clerk-react';
import { EditorLayout } from './components/layout/EditorLayout';
import { ProjectExplorerLayout } from './components/layout/ProjectExplorerLayout';
import { DebugPanel } from './components/debug/DebugPanel';
import { useProjectStore } from './store/projectStore';
import { useEditorStore } from './store/editorStore';
import { shouldWarmStartProjectExplorer } from '@/lib/authWarmStart';
import { resolveDesktopAuthUrls } from '@/lib/desktopAuthUrls';

const E2E_AUTH_BYPASS = import.meta.env.VITE_E2E_AUTH_BYPASS === '1';
const DESKTOP_AUTH_URLS = resolveDesktopAuthUrls();

function resetSessionStateForAccountBoundary() {
  useProjectStore.getState().closeProject();
  useEditorStore.setState({
    selectedSceneId: null,
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedComponentId: null,
    isPlaying: false,
    showProjectDialog: false,
    showReusableLibrary: false,
    showPlayValidationDialog: false,
    playValidationIssues: [],
    activeInspectorTab: 'object',
    objectPickerOpen: false,
    objectPickerCallback: null,
    objectPickerExcludeId: null,
    backgroundEditorOpen: false,
    backgroundEditorSceneId: null,
  });
}

function SignedOutScreen() {
  const isDesktopRuntime = typeof window !== 'undefined' && !!window.desktopAssistant;
  const shouldForceDesktopAuthUrls =
    isDesktopRuntime
    && typeof window !== 'undefined'
    && window.location.protocol === 'file:';

  useEffect(() => {
    resetSessionStateForAccountBoundary();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignIn
        routing={shouldForceDesktopAuthUrls ? 'virtual' : undefined}
        signUpUrl={shouldForceDesktopAuthUrls ? DESKTOP_AUTH_URLS.signUpUrl : undefined}
        signUpForceRedirectUrl={shouldForceDesktopAuthUrls ? DESKTOP_AUTH_URLS.redirectUrl : undefined}
        signUpFallbackRedirectUrl={shouldForceDesktopAuthUrls ? DESKTOP_AUTH_URLS.redirectUrl : undefined}
        forceRedirectUrl={shouldForceDesktopAuthUrls ? DESKTOP_AUTH_URLS.redirectUrl : undefined}
        fallbackRedirectUrl={shouldForceDesktopAuthUrls ? DESKTOP_AUTH_URLS.redirectUrl : undefined}
      />
    </div>
  );
}

function AppShell({
  authBootstrapState = 'steady',
  isAuthenticated = true,
}: {
  authBootstrapState?: 'steady' | 'reconnecting';
  isAuthenticated?: boolean;
}) {
  const { user } = useUser();
  const previousUserIdRef = useRef<string | null>(null);
  const location = useLocation();
  const setDarkMode = useEditorStore((state) => state.setDarkMode);
  const userSettings = useQuery(api.userSettings.getMySettings, isAuthenticated && user ? {} : 'skip');

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    const previousUserId = previousUserIdRef.current;
    if (previousUserId && nextUserId && previousUserId !== nextUserId) {
      resetSessionStateForAccountBoundary();
    }
    previousUserIdRef.current = nextUserId;
  }, [user?.id]);

  useEffect(() => {
    if (!userSettings || userSettings.isDarkMode === undefined) {
      return;
    }
    setDarkMode(userSettings.isDarkMode);
  }, [setDarkMode, userSettings]);

  const isHomeRoute = location.pathname === '/';

  return (
    <div className="app-shell h-full">
      {isAuthenticated && user && isHomeRoute ? (
        <div className="fixed right-4 top-3 z-[100300]">
          <UserButton />
        </div>
      ) : null}
      <Routes>
        <Route path="/" element={<ProjectExplorerLayout authBootstrapState={authBootstrapState} />} />
        <Route path="/project/:projectId" element={<EditorLayout />} />
      </Routes>
      {(location.pathname === '/' || location.pathname.startsWith('/project/')) ? <DebugPanel /> : null}
    </div>
  );
}

function PreparingAuthenticationScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      Preparing authentication...
    </div>
  );
}

function AuthGate() {
  const location = useLocation();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { isLoaded: isClerkLoaded, isSignedIn } = useAuth();

  if (shouldWarmStartProjectExplorer({
    clerkLoaded: isClerkLoaded,
    clerkSignedIn: isSignedIn ?? false,
    convexAuthenticated: isAuthenticated,
    convexLoading: isLoading,
    pathname: location.pathname,
  })) {
    return <AppShell authBootstrapState="reconnecting" isAuthenticated={false} />;
  }

  if (isLoading) {
    return <PreparingAuthenticationScreen />;
  }

  if (!isAuthenticated) {
    return <SignedOutScreen />;
  }

  return <AppShell isAuthenticated />;
}

function App() {
  if (E2E_AUTH_BYPASS) {
    return <AppShell isAuthenticated />;
  }

  return <AuthGate />;
}

export default App;
