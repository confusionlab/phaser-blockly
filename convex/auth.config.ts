const primaryIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim();
const issuerDomains = primaryIssuer ? [primaryIssuer] : [];

export default {
  providers: issuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
};
