import * as http from "node:http";
import { AnalyticsLogger } from "./analytics.js";
import { Cache } from "./cache.js";
import { channelsFor, selectChannel, stateKey } from "./channels.js";
import { config } from "./config.js";
import type {
  ArtifactManifestRelease,
  LatestJson,
  SimpleRelease,
} from "./github.js";
import {
  aggregateNotes,
  fetchArtifactManifestRelease,
  fetchSimpleReleases,
  fetchTauriReleases,
  findPlatformUpdate,
} from "./github.js";
import { NotesStore } from "./notes-store.js";
import type { ProductConfig } from "./products.js";
import { findProduct, productById, products } from "./products.js";
import { generateStatsHtml } from "./stats.js";
import { compareVersions, isValidVersion } from "./version.js";

// Per-product state
interface TauriProductState {
  kind: "tauri";
  product: ProductConfig;
  channel: string;
  cache: Cache<LatestJson>;
  notesStore: NotesStore;
}

interface SimpleProductState {
  kind: "simple";
  product: ProductConfig;
  channel: string;
  cache: Cache<SimpleRelease>;
  notesStore: NotesStore;
}

interface ArtifactManifestProductState {
  kind: "artifact-manifest";
  product: ProductConfig;
  channel: string;
  cache: Cache<ArtifactManifestRelease>;
}

type ProductState =
  | TauriProductState
  | SimpleProductState
  | ArtifactManifestProductState;

const analytics = new AnalyticsLogger(config.logDir);
const productStates = new Map<string, ProductState>();

for (const product of products) {
  for (const channel of Object.keys(channelsFor(product))) {
    // Preserve the existing Stable disk cache; never import it into another channel.
    const rule = channelsFor(product)[channel];
    const namespace =
      channel === "stable"
        ? ""
        : `/channels/${channel}/${encodeURIComponent(`${rule.releaseKind}-${rule.tagPrefix}`)}`;
    const productDir = `${config.logDir}/${product.id}${namespace}`;
    const notesStore = new NotesStore(`${productDir}/notes-cache.json`);

    if (product.artifactManifest) {
      const cache = new Cache<ArtifactManifestRelease>(
        async () => {
          const result = await fetchArtifactManifestRelease(
            product,
            config.githubToken,
          );
          return result?.latest ?? null;
        },
        config.cacheTtlMs,
        `${productDir}/artifact-manifest-cache.json`,
      );
      productStates.set(stateKey(product, channel), {
        kind: "artifact-manifest",
        product,
        channel,
        cache,
      });
    } else if (product.tauriUpdates) {
      const cache = new Cache<LatestJson>(
        async () => {
          const result = await fetchTauriReleases(
            product,
            config.githubToken,
            channel,
          );
          if (!result) return null;
          notesStore.merge(result.freshNotes);
          return result.latest;
        },
        config.cacheTtlMs,
        `${productDir}/latest-cache.json`,
        (next, previous) =>
          compareVersions(next.version, previous.version) >= 0,
      );
      productStates.set(stateKey(product, channel), {
        kind: "tauri",
        product,
        channel,
        cache,
        notesStore,
      });
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
      productStates.set(stateKey(product, channel), {
        kind: "simple",
        product,
        channel,
        cache,
        notesStore,
      });
    }
  }
}

function resolveProduct(
  req: http.IncomingMessage,
  pathname: string,
): { product: ProductConfig; remainingPath: string } | undefined {
  // Check x-forwarded-host first (reverse proxy), then Host header
  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader =
    typeof forwardedHost === "string" ? forwardedHost : req.headers.host || "";
  const host = hostHeader.split(":")[0]; // strip port

  const found = findProduct(host, pathname);
  if (found) return found;

  const defaultProduct = productById.get(config.defaultProductId);
  if (defaultProduct)
    return { product: defaultProduct, remainingPath: pathname };

  return undefined;
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

  const notes = aggregateNotes(
    state.notesStore
      .getAll()
      .filter((n) => compareVersions(n.version, latest.version) <= 0),
    currentVersion,
  );
  const platform = findPlatformUpdate(latest, target, arch, notes);
  const updateAvailable =
    !!platform && compareVersions(latest.version, currentVersion) > 0;

  analytics.log({
    ts: new Date().toISOString(),
    product: state.product.id,
    channel: state.channel,
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

  sendJson(res, 200, { ...platform, channel: state.channel });
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
      channel: state.channel,
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

async function handleArtifactManifestCheck(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: ArtifactManifestProductState,
  arch?: string,
  currentVersion?: string,
): Promise<void> {
  const latest = await state.cache.get();
  if (!latest) {
    sendJson(res, 500, { error: "Unable to fetch artifact manifest" });
    return;
  }

  if (currentVersion) {
    const updateAvailable = compareVersions(latest.version, currentVersion) > 0;
    analytics.log({
      ts: new Date().toISOString(),
      product: state.product.id,
      channel: state.channel,
      ip: getClientIp(req),
      target: "crostini",
      arch: arch ?? "",
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
    schemaVersion: 1,
    version: latest.version,
    publishedAt: latest.pub_date,
    manifest: latest.manifest,
    signature: latest.signature,
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }

  const { pathname, searchParams } = new URL(
    req.url || "/",
    "http://localhost",
  );
  const segments = pathname.split("/").filter(Boolean);

  // GET /health — global, no product needed
  if (segments[0] === "health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  // Resolve product (strips pathPrefix if present)
  const resolved = resolveProduct(req, pathname);
  if (!resolved) {
    sendJson(res, 404, { error: "Unknown product for this hostname" });
    return;
  }
  const { product, remainingPath } = resolved;
  const routeSegments = remainingPath.split("/").filter(Boolean);

  if (remainingPath === "/channels") {
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, {
      schemaVersion: 1,
      channels: Object.entries(channelsFor(product)).map(([id, rule]) => ({
        id,
        displayName: rule.displayName,
      })),
    });
    return;
  }
  let channel: string;
  try {
    channel = selectChannel(product, searchParams);
  } catch (error) {
    sendJson(res, 400, { error: String(error) });
    return;
  }
  res.setHeader("X-Update-Channel", channel);
  res.setHeader("Cache-Control", "no-store");
  const state = productStates.get(stateKey(product, channel));
  if (!state) {
    sendJson(res, 500, { error: "Product state not initialized" });
    return;
  }

  if (routeSegments[0] === "manifest") {
    if (state.kind !== "artifact-manifest") {
      sendJson(res, 404, {
        error: "This product does not publish an artifact manifest",
      });
      return;
    }
    const routeArguments = routeSegments.slice(1);
    let arch: string | undefined;
    let currentVersion: string | undefined;
    if (routeArguments.length === 1) {
      [currentVersion] = routeArguments;
    } else if (routeArguments.length === 2) {
      [arch, currentVersion] = routeArguments;
      if (arch !== "x86_64" && arch !== "aarch64") {
        sendJson(res, 400, { error: "Invalid architecture" });
        return;
      }
    } else if (routeArguments.length > 2) {
      sendJson(res, 404, { error: "Invalid artifact manifest route" });
      return;
    }
    if (currentVersion && !isValidVersion(currentVersion)) {
      sendJson(res, 400, { error: "Invalid version format" });
      return;
    }
    try {
      await handleArtifactManifestCheck(req, res, state, arch, currentVersion);
    } catch (err) {
      console.error("Artifact manifest check error:", err);
      sendJson(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /sw.js — service worker for cache busting
  if (routeSegments[0] === "sw.js") {
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
  if (routeSegments[0] === "stats") {
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
  if (routeSegments[0] === "tauri" && routeSegments.length === 4) {
    if (!product.tauriUpdates) {
      sendJson(res, 404, { error: "This product does not use Tauri updates" });
      return;
    }
    const [, target, arch, currentVersion] = routeSegments;
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
      console.error(`Update check error ${product.id}/${channel}:`, err);
      sendJson(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /version — latest version info (all products)
  // GET /version/:currentVersion — check for update with analytics
  if (routeSegments[0] === "version") {
    const currentVersion = routeSegments[1];
    if (currentVersion && !isValidVersion(currentVersion)) {
      sendJson(res, 400, { error: "Invalid version format" });
      return;
    }

    if (state.kind === "artifact-manifest") {
      const latest = await state.cache.get();
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
