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

export const products: ProductConfig[] = [
  {
    id: "jstorrent",
    displayName: "JSTorrent",
    hostnames: ["updates.jstorrent.com"],
    githubRepo: "kzahel/JSTorrent",
    tagPrefix: "tauri-app-v",
    tauriUpdates: true,
  },
  {
    id: "web-server",
    displayName: "200 OK - Web Server",
    hostnames: ["updates.ok200.app"],
    githubRepo: "kzahel/web-server",
    tagPrefix: "desktop-v",
    tauriUpdates: true,
  },
  {
    id: "yepanywhere",
    displayName: "Yep Anywhere",
    hostnames: ["updates.yepanywhere.com"],
    githubRepo: "kzahel/yepanywhere",
    tagPrefix: "v",
    tauriUpdates: false,
  },
];

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
