import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { useAuth, ClerkProvider } from '@clerk/clerk-react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import './index.css'
import App from './App.tsx'
import { getConvexCloudUrl } from '@/lib/convexEnv'
import { resolveDesktopAuthUrls } from '@/lib/desktopAuthUrls'

function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function getClerkPublishableKey(preferProd: boolean): string | null {
  const devKey = trimOrUndefined(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY_DEV)
  const prodKey = trimOrUndefined(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY_PROD)
  const fallback = trimOrUndefined(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)
  const desktopForceProdKey = import.meta.env.VITE_DESKTOP_USE_PROD_CLERK_KEY === '1'

  if (import.meta.env.DEV) {
    if (preferProd && desktopForceProdKey) {
      return prodKey || devKey || fallback || null
    }
    return devKey || fallback || prodKey || null
  }
  if (preferProd) {
    return prodKey || devKey || fallback || null
  }
  if (import.meta.env.PROD) {
    return prodKey || fallback || devKey || null
  }
  return fallback || devKey || prodKey || null
}

function clearStaleDesktopClerkState(currentPublishableKey: string): void {
  if (!isDesktopRuntime) {
    return
  }

  try {
    const markerKey = 'pochacoding.clerk.publishable_key'
    const previousPublishableKey = localStorage.getItem(markerKey)
    if (previousPublishableKey === currentPublishableKey) {
      return
    }

    const shouldClear = (key: string) => {
      const normalized = key.toLowerCase()
      return normalized.startsWith('__clerk') || normalized.startsWith('clerk.')
    }

    for (const key of Object.keys(localStorage)) {
      if (shouldClear(key)) {
        localStorage.removeItem(key)
      }
    }

    for (const key of Object.keys(sessionStorage)) {
      if (shouldClear(key)) {
        sessionStorage.removeItem(key)
      }
    }

    localStorage.setItem(markerKey, currentPublishableKey)
  } catch (error) {
    console.warn('[DesktopAuth] Failed to reset stale Clerk state:', error)
  }
}

const rootElement = document.getElementById('root')
const isDesktopRuntime = typeof window !== 'undefined' && !!window.desktopAssistant
const convexUrl = getConvexCloudUrl()
const clerkPublishableKey = getClerkPublishableKey(isDesktopRuntime)
const desktopAuthUrls = resolveDesktopAuthUrls()
const appBranch = import.meta.env.VITE_APP_BRANCH

if (appBranch) {
  document.title = appBranch
}

if (!rootElement) {
  throw new Error('Root element not found')
}

if (!convexUrl || !clerkPublishableKey) {
  createRoot(rootElement).render(
    <StrictMode>
      <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
        Missing required env.
        {!convexUrl ? (
          <>
            {' '}
            Set `VITE_CONVEX_URL_DEV` for development and `VITE_CONVEX_URL_PROD` for production.
          </>
        ) : null}
        {!clerkPublishableKey
          ? ' Set `VITE_CLERK_PUBLISHABLE_KEY_DEV` and `VITE_CLERK_PUBLISHABLE_KEY_PROD` (or fallback `VITE_CLERK_PUBLISHABLE_KEY`).'
          : null}
      </div>
    </StrictMode>,
  )
  throw new Error('Missing required env for Convex/Clerk bootstrap.')
}

const convex = new ConvexReactClient(convexUrl)
clearStaleDesktopClerkState(clerkPublishableKey)

createRoot(rootElement).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      standardBrowser={!isDesktopRuntime}
      signInUrl={isDesktopRuntime ? desktopAuthUrls.signInUrl : undefined}
      signUpUrl={isDesktopRuntime ? desktopAuthUrls.signUpUrl : undefined}
      signInForceRedirectUrl={isDesktopRuntime ? desktopAuthUrls.redirectUrl : undefined}
      signUpForceRedirectUrl={isDesktopRuntime ? desktopAuthUrls.redirectUrl : undefined}
      signInFallbackRedirectUrl={isDesktopRuntime ? desktopAuthUrls.redirectUrl : undefined}
      signUpFallbackRedirectUrl={isDesktopRuntime ? desktopAuthUrls.redirectUrl : undefined}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {isDesktopRuntime ? (
          <HashRouter>
            <App />
          </HashRouter>
        ) : (
          <BrowserRouter>
            <App />
          </BrowserRouter>
        )}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </StrictMode>,
)
