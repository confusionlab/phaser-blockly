function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

const PROD_REDIRECT_URL = 'https://accounts.confusionlab.com/';
const PROD_SIGN_IN_URL = 'https://accounts.confusionlab.com/sign-in';
const PROD_SIGN_UP_URL = 'https://accounts.confusionlab.com/sign-up';

const DEV_REDIRECT_URL = 'http://localhost:5173/';
const DEV_SIGN_IN_URL = 'http://localhost:5173/sign-in';
const DEV_SIGN_UP_URL = 'http://localhost:5173/sign-up';

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveDesktopAuthUrls() {
  const envRedirect = trimOrUndefined(import.meta.env.VITE_DESKTOP_AUTH_REDIRECT_URL);
  const envSignIn = trimOrUndefined(import.meta.env.VITE_DESKTOP_AUTH_SIGN_IN_URL);
  const envSignUp = trimOrUndefined(import.meta.env.VITE_DESKTOP_AUTH_SIGN_UP_URL);

  if (import.meta.env.PROD) {
    // Production Clerk redirects must stay on HTTPS web origins.
    return {
      redirectUrl: envRedirect && isHttpsUrl(envRedirect) ? envRedirect : PROD_REDIRECT_URL,
      signInUrl: envSignIn && isHttpsUrl(envSignIn) ? envSignIn : PROD_SIGN_IN_URL,
      signUpUrl: envSignUp && isHttpsUrl(envSignUp) ? envSignUp : PROD_SIGN_UP_URL,
    };
  }

  return {
    redirectUrl: envRedirect || DEV_REDIRECT_URL,
    signInUrl: envSignIn || DEV_SIGN_IN_URL,
    signUpUrl: envSignUp || DEV_SIGN_UP_URL,
  };
}
