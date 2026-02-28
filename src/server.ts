import * as http from "node:http";
import { AnalyticsLogger } from "./analytics.js";
import { Cache } from "./cache.js";
import { config } from "./config.js";
import type { LatestJson, SimpleRelease } from "./github.js";
import {
  aggregateNotes,
  fetchSimpleReleases,
  fetchTauriReleases,
  findPlatformUpdate,
} from "./github.js";
import { NotesStore } from "./notes-store.js";
import type { ProductConfig } from "./products.js";
import { productByHostname, productById, products } from "./products.js";
import { generateStatsHtml } from "./stats.js";
import { compareVersions, isValidVersion } from "./version.js";

// Per-product state
interface TauriProductState {
  product: ProductConfig;
  cache: Cache<LatestJson>;
  notesStore: NotesStore;
}

interface SimpleProductState {
  product: ProductConfig;
  cache: Cache<SimpleRelease>;
  notesStore: NotesStore;
}

type ProductState = TauriProductState | SimpleProductState;

const analytics = new AnalyticsLogger(config.logDir);
const productStates = new Map<string, ProductState>();

for (const product of products) {
  const productDir = `${config.logDir}/${product.id}`;
  const notesStore = new NotesStore(`${productDir}/notes-cache.json`);

  if (product.tauriUpdates) {
    const cache = new Cache<LatestJson>(
      async () => {
        const result = await fetchTauriReleases(product, config.githubToken);
        if (!result) return null;
        notesStore.merge(result.freshNotes);
        return result.latest;
      },
      config.cacheTtlMs,
      `${productDir}/latest-cache.json`,
    );
    productStates.set(product.id, { product, cache, notesStore });
  } else {
    const cache = new Cache<SimpleRelease>(
      async () => {
        const result = await fetchSimpleReleases(product, config.githubToken);
        if (!result) return null;
        notesStore.merge(result.freshNotes);
        return result.latest;
      },
      config.cacheTtlMs,
      `${productDir}/latest-cache.json`,
    );
    productStates.set(product.id, { product, cache, notesStore });
  }
}

function resolveProduct(req: http.IncomingMessage): ProductConfig | undefined {
  // Check x-forwarded-host first (reverse proxy), then Host header
  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader =
    typeof forwardedHost === "string" ? forwardedHost : req.headers.host || "";
  const host = hostHeader.split(":")[0]; // strip port
  return (
    productByHostname.get(host) ?? productById.get(config.defaultProductId)
  );
}

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleTauriUpdateCheck(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: TauriProductState,
  target: string,
  arch: string,
  currentVersion: string,
): Promise<void> {
  const latest = await state.cache.get();
  if (!latest) {
    sendJson(res, 500, { error: "Unable to fetch release info" });
    return;
  }

  const notes = aggregateNotes(state.notesStore.getAll(), currentVersion);
  const platform = findPlatformUpdate(latest, target, arch, notes);
  const updateAvailable =
    !!platform && compareVersions(latest.version, currentVersion) > 0;

  analytics.log({
    ts: new Date().toISOString(),
    product: state.product.id,
    ip: getClientIp(req),
    target,
    arch,
    currentVersion,
    latestVersion: latest.version,
    updateAvailable,
    userAgent: req.headers["user-agent"] || "",
    cfuId: (req.headers["x-cfu-id"] as string) || "",
    checkReason: (req.headers["x-check-reason"] as string) || "",
  });

  if (!updateAvailable) {
    res.writeHead(204);
    res.end();
    return;
  }

  sendJson(res, 200, platform);
}

async function handleVersionCheck(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: SimpleProductState,
  currentVersion?: string,
): Promise<void> {
  const latest = await state.cache.get();
  if (!latest) {
    sendJson(res, 500, { error: "Unable to fetch release info" });
    return;
  }

  if (currentVersion) {
    const updateAvailable = compareVersions(latest.version, currentVersion) > 0;

    analytics.log({
      ts: new Date().toISOString(),
      product: state.product.id,
      ip: getClientIp(req),
      target: "",
      arch: "",
      currentVersion,
      latestVersion: latest.version,
      updateAvailable,
      userAgent: req.headers["user-agent"] || "",
      cfuId: (req.headers["x-cfu-id"] as string) || "",
      checkReason: (req.headers["x-check-reason"] as string) || "",
    });

    if (!updateAvailable) {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  sendJson(res, 200, {
    version: latest.version,
    notes: currentVersion
      ? aggregateNotes(state.notesStore.getAll(), currentVersion)
      : latest.notes,
    pub_date: latest.pub_date,
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }

  const { pathname } = new URL(req.url || "/", "http://localhost");
  const segments = pathname.split("/").filter(Boolean);

  // GET /health — global, no product needed
  if (segments[0] === "health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  // Resolve product for all other routes
  const product = resolveProduct(req);
  if (!product) {
    sendJson(res, 404, { error: "Unknown product for this hostname" });
    return;
  }

  const state = productStates.get(product.id);
  if (!state) {
    sendJson(res, 500, { error: "Product state not initialized" });
    return;
  }

  // GET /sw.js — service worker for cache busting
  if (segments[0] === "sw.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache",
    });
    res.end(`self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.map(c => caches.delete(c)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});`);
    return;
  }

  // GET /stats
  if (segments[0] === "stats") {
    const html = generateStatsHtml(
      config.logDir,
      product.id,
      product.displayName,
    );
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(html);
    return;
  }

  // GET /tauri/:target/:arch/:currentVersion — Tauri products only
  if (segments[0] === "tauri" && segments.length === 4) {
    if (!product.tauriUpdates) {
      sendJson(res, 404, { error: "This product does not use Tauri updates" });
      return;
    }
    const [, target, arch, currentVersion] = segments;
    if (!isValidVersion(currentVersion)) {
      sendJson(res, 400, { error: "Invalid version format" });
      return;
    }
    try {
      await handleTauriUpdateCheck(
        req,
        res,
        state as TauriProductState,
        target,
        arch,
        currentVersion,
      );
    } catch (err) {
      console.error("Update check error:", err);
      sendJson(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /version — latest version info (all products)
  // GET /version/:currentVersion — check for update with analytics
  if (segments[0] === "version") {
    const currentVersion = segments[1];
    if (currentVersion && !isValidVersion(currentVersion)) {
      sendJson(res, 400, { error: "Invalid version format" });
      return;
    }

    if (product.tauriUpdates) {
      // For Tauri products, /version returns just the latest version
      const latest = await (state as TauriProductState).cache.get();
      if (!latest) {
        sendJson(res, 500, { error: "Unable to fetch release info" });
        return;
      }
      sendJson(res, 200, {
        version: latest.version,
        pub_date: latest.pub_date,
      });
      return;
    }

    try {
      await handleVersionCheck(
        req,
        res,
        state as SimpleProductState,
        currentVersion,
      );
    } catch (err) {
      console.error("Version check error:", err);
      sendJson(res, 500, { error: "Internal server error" });
    }
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(config.port, () => {
  console.log(`Update server listening on port ${config.port}`);
  console.log(
    `Serving ${products.length} products: ${products.map((p) => p.id).join(", ")}`,
  );
});

export { server, analytics, productStates };
