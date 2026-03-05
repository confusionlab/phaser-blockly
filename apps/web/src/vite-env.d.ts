/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_CLERK_BILLING_PLAN_IDS?: string;
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_CONVEX_URL_DEV?: string;
  readonly VITE_CONVEX_URL_PROD?: string;
  readonly VITE_CONVEX_SITE_URL?: string;
  readonly VITE_CONVEX_SITE_URL_DEV?: string;
  readonly VITE_CONVEX_SITE_URL_PROD?: string;
  readonly VITE_APP_BRANCH?: string;
  readonly VITE_E2E_AUTH_BYPASS?: string;
  readonly VITE_E2E_AUTH_BYPASS_USER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
