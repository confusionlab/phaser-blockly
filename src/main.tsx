import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import './index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root')
const convexUrl = import.meta.env.VITE_CONVEX_URL
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
        Missing `VITE_CONVEX_URL`. Set it in your Vercel Preview environment variables.
      </div>
    </StrictMode>,
  )
  throw new Error(
    'Missing VITE_CONVEX_URL. Add it to Vercel Project Settings -> Environment Variables for Preview.',
  )
}

const convex = new ConvexReactClient(convexUrl)

createRoot(rootElement).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>,
)
