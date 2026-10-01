export function routeRequiresConsent(segments: readonly string[]): boolean {
  const root = segments[0];
  // Browsing the product does not transmit a photo. Consent is requested when
  // starting a scan, before capture or opening stored health records.
  return Boolean(
    root &&
    ![
      "index",
      "onboarding",
      "(tabs)",
      "learn",
      "roadmap",
      "model-card",
    ].includes(root),
  );
}
