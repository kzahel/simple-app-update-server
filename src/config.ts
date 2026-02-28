const logDir = process.env.LOG_DIR || "./logs";

export const config = {
  port: Number.parseInt(process.env.PORT || "3100", 10),
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  logDir,
  githubToken: process.env.GITHUB_TOKEN || "",
  /** Fallback product ID when hostname doesn't match (for dev/testing) */
  defaultProductId: process.env.DEFAULT_PRODUCT || "",
  /** Path to products configuration JSON file */
  productsConfig: process.env.PRODUCTS_CONFIG || "./products.json",
};
