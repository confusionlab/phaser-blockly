const issuerDomain = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? "").trim();

export default {
  providers: issuerDomain
    ? [
        {
          domain: issuerDomain,
          applicationID: "convex",
        },
      ]
    : [],
};
