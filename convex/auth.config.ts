const issuerDomains = [
  process.env.CLERK_JWT_ISSUER_DOMAIN,
  process.env.CLERK_JWT_ISSUER_DOMAIN_SECONDARY,
]
  .map((value) => value?.trim())
  .filter((value): value is string => typeof value === "string" && value.length > 0);

export default {
  providers: issuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
};
