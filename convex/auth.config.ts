const issuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim();
const issuerDomains = issuerDomain ? [issuerDomain] : [];

export default {
  providers: issuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
};
