import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { useAuth, ClerkProvider } from '@clerk/clerk-react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import './index.css'
import App from './App.tsx'
import { getConvexCloudUrl } from '@/lib/convexEnv'

const rootElement = document.getElementById('root')
const convexUrl = getConvexCloudUrl()
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() || null
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
        {!clerkPublishableKey ? ' Set `VITE_CLERK_PUBLISHABLE_KEY`.' : null}
      </div>
    </StrictMode>,
  )
  throw new Error('Missing required env for Convex/Clerk bootstrap.')
}

const convex = new ConvexReactClient(convexUrl)

createRoot(rootElement).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {typeof window !== 'undefined' && window.desktopAssistant ? (
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
