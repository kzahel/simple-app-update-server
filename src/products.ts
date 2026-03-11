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
  /** Optional path prefix for products sharing a hostname (e.g. "/bridge"). Must start with "/". */
  pathPrefix?: string;
}

function validateProduct(p: unknown, label: string): ProductConfig {
  if (typeof p !== "object" || p === null) {
    throw new Error(`${label}: must be an object`);
  }
  for (const key of ["id", "displayName", "githubRepo", "tagPrefix"]) {
    if (typeof (p as Record<string, unknown>)[key] !== "string") {
      throw new Error(`${label}.${key}: must be a string`);
    }
  }
  if (!Array.isArray((p as Record<string, unknown>).hostnames)) {
    throw new Error(`${label}.hostnames: must be an array of strings`);
  }
  if (typeof (p as Record<string, unknown>).tauriUpdates !== "boolean") {
    throw new Error(`${label}.tauriUpdates: must be a boolean`);
  }
  const pathPrefix = (p as Record<string, unknown>).pathPrefix;
  if (pathPrefix !== undefined) {
    if (typeof pathPrefix !== "string" || !pathPrefix.startsWith("/")) {
      throw new Error(
        `${label}.pathPrefix: must be a string starting with "/"`,
      );
    }
  }
  return p as ProductConfig;
}

/** Parse a JSON file that contains either a single product object or an array of products. */
function parseProductFile(filePath: string): ProductConfig[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data: unknown = JSON.parse(raw);
  const fileName = path.basename(filePath);

  if (Array.isArray(data)) {
    return data.map((item, i) => validateProduct(item, `${fileName}[${i}]`));
  }
  return [validateProduct(data, fileName)];
}

function loadProducts(): ProductConfig[] {
  const configPath = path.resolve(config.productsConfig);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(configPath);
  } catch {
    console.error(
      `\nFATAL: Cannot read products config: ${configPath}\n` +
        "Set PRODUCTS_CONFIG env var or create products.json (file) or products.d/ (directory).\n" +
        "See products.sample.json for the expected format.\n",
    );
    process.exit(1);
  }

  const allProducts: ProductConfig[] = [];

  if (stat.isDirectory()) {
    const files = fs
      .readdirSync(configPath)
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length === 0) {
      console.error(
        `\nFATAL: No .json files found in products directory: ${configPath}\n`,
      );
      process.exit(1);
    }
    for (const file of files) {
      try {
        allProducts.push(...parseProductFile(path.join(configPath, file)));
      } catch (err) {
        console.error(
          `\nFATAL: Invalid product config in ${path.join(configPath, file)}\n`,
          err,
        );
        process.exit(1);
      }
    }
  } else {
    try {
      allProducts.push(...parseProductFile(configPath));
    } catch (err) {
      console.error(`\nFATAL: Invalid products config: ${configPath}\n`, err);
      process.exit(1);
    }
  }

  if (allProducts.length === 0) {
    console.error("\nFATAL: No products defined in config\n");
    process.exit(1);
  }

  return allProducts;
}

export const products: ProductConfig[] = loadProducts();

/** Build hostname -> products lookup map (multiple products can share a hostname via pathPrefix) */
export const productsByHostname = new Map<string, ProductConfig[]>();
for (const p of products) {
  for (const h of p.hostnames) {
    const existing = productsByHostname.get(h) ?? [];
    existing.push(p);
    productsByHostname.set(h, existing);
  }
}

/** Build id -> product lookup map */
export const productById = new Map<string, ProductConfig>();
for (const p of products) {
  productById.set(p.id, p);
}

/**
 * Find the product for a hostname + pathname.
 * Products with a pathPrefix are checked first (longest prefix wins).
 * A product without a pathPrefix is the fallback for that hostname.
 */
export function findProduct(
  hostname: string,
  pathname: string,
): { product: ProductConfig; remainingPath: string } | undefined {
  const candidates = productsByHostname.get(hostname);
  if (!candidates) return undefined;

  // Sort: products with pathPrefix first (longest first), then without
  const sorted = [...candidates].sort((a, b) => {
    if (a.pathPrefix && !b.pathPrefix) return -1;
    if (!a.pathPrefix && b.pathPrefix) return 1;
    if (a.pathPrefix && b.pathPrefix)
      return b.pathPrefix.length - a.pathPrefix.length;
    return 0;
  });

  for (const p of sorted) {
    if (p.pathPrefix) {
      if (
        pathname === p.pathPrefix ||
        pathname.startsWith(`${p.pathPrefix}/`)
      ) {
        return {
          product: p,
          remainingPath: pathname.slice(p.pathPrefix.length) || "/",
        };
      }
    } else {
      return { product: p, remainingPath: pathname };
    }
  }

  return undefined;
}
