import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "./config.js";

export interface ProductConfig {
  /** Slug used in log filenames, URL paths, display */
  id: string;
  /** Display name for stats dashboard */
  displayName: string;
  /** Hostnames that route to this product */
  hostnames: string[];
  /** GitHub owner/repo */
  githubRepo: string;
  /** Tag prefix to filter releases */
  tagPrefix: string;
  /** Whether this product uses Tauri update protocol (latest.json in GitHub releases) */
  tauriUpdates: boolean;
}

function validateProducts(data: unknown): ProductConfig[] {
  if (!Array.isArray(data)) {
    throw new Error("Products config must be a JSON array");
  }
  if (data.length === 0) {
    throw new Error("Products config must contain at least one product");
  }
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    const prefix = `products[${i}]`;
    if (typeof p !== "object" || p === null) {
      throw new Error(`${prefix}: must be an object`);
    }
    for (const key of ["id", "displayName", "githubRepo", "tagPrefix"]) {
      if (typeof (p as Record<string, unknown>)[key] !== "string") {
        throw new Error(`${prefix}.${key}: must be a string`);
      }
    }
    if (!Array.isArray((p as Record<string, unknown>).hostnames)) {
      throw new Error(`${prefix}.hostnames: must be an array of strings`);
    }
    if (typeof (p as Record<string, unknown>).tauriUpdates !== "boolean") {
      throw new Error(`${prefix}.tauriUpdates: must be a boolean`);
    }
  }
  return data as ProductConfig[];
}

function loadProducts(): ProductConfig[] {
  const configPath = path.resolve(config.productsConfig);
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    console.error(
      `\nFATAL: Cannot read products config file: ${configPath}\n` +
        "Set PRODUCTS_CONFIG env var or create products.json at the project root.\n" +
        "See products.sample.json for the expected format.\n",
    );
    process.exit(1);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(
      `\nFATAL: Invalid JSON in products config: ${configPath}\n`,
      err,
    );
    process.exit(1);
  }

  try {
    return validateProducts(data);
  } catch (err) {
    console.error(`\nFATAL: Invalid products config: ${configPath}\n`, err);
    process.exit(1);
  }
}

export const products: ProductConfig[] = loadProducts();

/** Build hostname -> product lookup map */
export const productByHostname = new Map<string, ProductConfig>();
for (const p of products) {
  for (const h of p.hostnames) {
    productByHostname.set(h, p);
  }
}

/** Build id -> product lookup map */
export const productById = new Map<string, ProductConfig>();
for (const p of products) {
  productById.set(p.id, p);
}
