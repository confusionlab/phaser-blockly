const issuerDomains = Object.entries(process.env)
  .filter(([key]) => key.startsWith("CLERK_JWT_ISSUER_DOMAIN"))
  .map(([, value]) => value?.trim())
  .filter((value): value is string => typeof value === "string" && value.length > 0);

export default {
  providers: issuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
};
