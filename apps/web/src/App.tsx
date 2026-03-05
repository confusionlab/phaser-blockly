import { useEffect, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { useQuery } from 'convex/react';
import { api } from '@convex-generated/api';
import { SignIn, UserButton, useUser } from '@clerk/clerk-react';
import { EditorLayout } from './components/layout/EditorLayout';
import { DebugPanel } from './components/debug/DebugPanel';
import { GlobalAssistantModal } from './components/assistant/GlobalAssistantModal';
import { BillingPage } from './components/billing/BillingPage';
import { useProjectStore } from './store/projectStore';
import { useEditorStore } from './store/editorStore';
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
    objectPickerOpen: false,
    objectPickerCallback: null,
    objectPickerExcludeId: null,
    backgroundEditorOpen: false,
    backgroundEditorSceneId: null,
  });
}

function SignedOutScreen() {
  const isDesktopRuntime = typeof window !== 'undefined' && !!window.desktopAssistant;

  useEffect(() => {
    resetSessionStateForAccountBoundary();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignIn
        routing={isDesktopRuntime ? 'virtual' : undefined}
        signUpUrl={isDesktopRuntime ? DESKTOP_AUTH_URLS.signUpUrl : undefined}
        signUpForceRedirectUrl={isDesktopRuntime ? DESKTOP_AUTH_URLS.redirectUrl : undefined}
        signUpFallbackRedirectUrl={isDesktopRuntime ? DESKTOP_AUTH_URLS.redirectUrl : undefined}
        forceRedirectUrl={isDesktopRuntime ? DESKTOP_AUTH_URLS.redirectUrl : undefined}
        fallbackRedirectUrl={isDesktopRuntime ? DESKTOP_AUTH_URLS.redirectUrl : undefined}
      />
    </div>
  );
}

function AuthenticatedShell() {
  const { user } = useUser();
  const previousUserIdRef = useRef<string | null>(null);
  const location = useLocation();
  const setDarkMode = useEditorStore((state) => state.setDarkMode);
  const userSettings = useQuery(api.userSettings.getMySettings, user ? {} : 'skip');

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

  const isEditorRoute =
    location.pathname === '/'
    || location.pathname.startsWith('/project/');
  const isHomeRoute = location.pathname === '/';

  return (
    <>
      {user && isHomeRoute ? (
        <div className="fixed right-4 top-3 z-[100300]">
          <UserButton />
        </div>
      ) : null}
      <Routes>
        <Route path="/" element={<EditorLayout />} />
        <Route path="/project/:projectId" element={<EditorLayout />} />
        <Route path="/billing" element={<BillingPage />} />
      </Routes>
      {isEditorRoute ? <GlobalAssistantModal /> : null}
      {isEditorRoute ? <DebugPanel /> : null}
    </>
  );
}

function App() {
  if (E2E_AUTH_BYPASS) {
    return <AuthenticatedShell />;
  }

  return (
    <>
      <AuthLoading>
        <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
          Preparing authentication...
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignedOutScreen />
      </Unauthenticated>
      <Authenticated>
        <AuthenticatedShell />
      </Authenticated>
    </>
  );
}

export default App;
