import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import './index.css'
import App from './App.tsx'
import { getConvexCloudUrl } from '@/lib/convexEnv'

const rootElement = document.getElementById('root')
const convexUrl = getConvexCloudUrl()
const appBranch = import.meta.env.VITE_APP_BRANCH

if (appBranch) {
  document.title = appBranch
}

if (!rootElement) {
  throw new Error('Root element not found')
}

if (!convexUrl) {
  createRoot(rootElement).render(
    <StrictMode>
      <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
        Missing Convex URL. Set `VITE_CONVEX_URL_DEV` for development and `VITE_CONVEX_URL_PROD` for production
        (or fallback `VITE_CONVEX_URL`).
      </div>
    </StrictMode>,
  )
  throw new Error(
    'Missing Convex URL. Configure VITE_CONVEX_URL_DEV / VITE_CONVEX_URL_PROD (or VITE_CONVEX_URL).',
  )
}

const convex = new ConvexReactClient(convexUrl)

createRoot(rootElement).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      {typeof window !== 'undefined' && window.desktopAssistant ? (
        <HashRouter>
          <App />
        </HashRouter>
      ) : (
        <BrowserRouter>
          <App />
        </BrowserRouter>
      )}
    </ConvexProvider>
  </StrictMode>,
)
