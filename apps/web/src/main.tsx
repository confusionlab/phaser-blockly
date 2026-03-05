import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { useAuth, ClerkProvider } from '@clerk/clerk-react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import './index.css'
import App from './App.tsx'
import { getConvexCloudUrl } from '@/lib/convexEnv'

function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function getClerkPublishableKey(preferProd: boolean): string | null {
  const devKey = trimOrUndefined(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY_DEV)
  const prodKey = trimOrUndefined(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY_PROD)
  const fallback = trimOrUndefined(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)

  if (preferProd) {
    return prodKey || devKey || fallback || null
  }
  if (import.meta.env.DEV) {
    return devKey || fallback || prodKey || null
  }
  if (import.meta.env.PROD) {
    return prodKey || fallback || devKey || null
  }
  return fallback || devKey || prodKey || null
}

const rootElement = document.getElementById('root')
const isDesktopRuntime = typeof window !== 'undefined' && !!window.desktopAssistant
const convexUrl = getConvexCloudUrl()
const clerkPublishableKey = getClerkPublishableKey(isDesktopRuntime)
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
            Set `VITE_CONVEX_URL_DEV` for development and `VITE_CONVEX_URL_PROD` for production
            (or fallback `VITE_CONVEX_URL`).
          </>
        ) : null}
        {!clerkPublishableKey
          ? ' Set `VITE_CLERK_PUBLISHABLE_KEY_DEV` and `VITE_CLERK_PUBLISHABLE_KEY_PROD` (or fallback `VITE_CLERK_PUBLISHABLE_KEY`). Desktop runtime prefers the prod key.'
          : null}
      </div>
    </StrictMode>,
  )
  throw new Error('Missing required env for Convex/Clerk bootstrap.')
}

const convex = new ConvexReactClient(convexUrl)

createRoot(rootElement).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey} standardBrowser={!isDesktopRuntime}>
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
