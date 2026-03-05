const issuerDomains = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

export default {
  providers: issuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
};
