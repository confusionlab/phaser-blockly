export function shouldWarmStartProjectExplorer(options: {
  clerkLoaded: boolean;
  clerkSignedIn: boolean;
  convexAuthenticated: boolean;
  convexLoading: boolean;
  pathname: string;
}): boolean {
  return (
    options.pathname === '/'
    && options.clerkLoaded
    && options.clerkSignedIn
    && options.convexLoading
    && !options.convexAuthenticated
  );
}
