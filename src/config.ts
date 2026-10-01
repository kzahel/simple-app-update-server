const logDir = process.env.LOG_DIR || "./logs";

export const config = {
  /** Optional private, pinned installation-cohort manifest. Disabled by default. */
  trialAssetsDirectory: process.env.TRIAL_ASSETS_DIRECTORY || "",
  trialUpdatesConfig: process.env.TRIAL_UPDATES_CONFIG || "",
  port: Number.parseInt(process.env.PORT || "3100", 10),
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  logDir,
  githubToken: process.env.GITHUB_TOKEN || "",
  /** Fallback product ID when hostname doesn't match (for dev/testing) */
  defaultProductId: process.env.DEFAULT_PRODUCT || "",
  /** Path to products config — a JSON file or a directory of JSON files */
  productsConfig: process.env.PRODUCTS_CONFIG || "./products.json",
};
