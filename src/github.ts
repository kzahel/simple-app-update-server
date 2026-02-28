import type { ProductConfig } from "./products.js";
import { compareVersions, isValidVersion } from "./version.js";

export interface LatestJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

export interface SimpleRelease {
  version: string;
  notes: string;
  pub_date: string;
}

export interface PlatformUpdate {
  version: string;
  notes: string;
  pub_date: string;
  url: string;
  signature: string;
}

export interface VersionNotes {
  version: string;
  notes: string;
}

export interface TauriFetchResult {
  latest: LatestJson;
  freshNotes: VersionNotes[];
}

export interface SimpleFetchResult {
  latest: SimpleRelease;
  freshNotes: VersionNotes[];
}

interface GitHubRelease {
  tag_name: string;
  body?: string;
  published_at?: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

/** Strip the "## Download" section that CI appends to release bodies. */
function stripDownloadSection(body: string): string {
  const idx = body.indexOf("## Download");
  if (idx === -1) return body.trim();
  return body.slice(0, idx).trim();
}

function makeHeaders(
  product: ProductConfig,
  githubToken: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": `${product.id}-update-server`,
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }
  return headers;
}

function extractVersionNotes(
  releases: GitHubRelease[],
  tagPrefix: string,
): VersionNotes[] {
  return releases
    .map((r) => ({
      version: r.tag_name.slice(tagPrefix.length),
      notes: r.body ? stripDownloadSection(r.body) : "",
    }))
    .filter((n) => n.notes.length > 0);
}

/** Fetch releases for a Tauri product (has latest.json asset with platform binaries). */
export async function fetchTauriReleases(
  product: ProductConfig,
  githubToken: string,
): Promise<TauriFetchResult | null> {
  const headers = makeHeaders(product, githubToken);

  const res = await fetch(
    `https://api.github.com/repos/${product.githubRepo}/releases?per_page=100`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }

  const releases = (await res.json()) as GitHubRelease[];
  const filtered = releases.filter((r) =>
    r.tag_name.startsWith(product.tagPrefix),
  );

  const latestRelease = filtered[0];
  if (!latestRelease) return null;

  const asset = latestRelease.assets.find((a) => a.name === "latest.json");
  if (!asset) return null;

  const jsonRes = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": `${product.id}-update-server` },
    redirect: "follow",
  });
  if (!jsonRes.ok) {
    throw new Error(`Failed to fetch latest.json: ${jsonRes.status}`);
  }

  const latest = (await jsonRes.json()) as LatestJson;
  const freshNotes = extractVersionNotes(filtered, product.tagPrefix);

  return { latest, freshNotes };
}

/** Fetch releases for a non-Tauri product (just version + notes from tags). */
export async function fetchSimpleReleases(
  product: ProductConfig,
  githubToken: string,
): Promise<SimpleFetchResult | null> {
  const headers = makeHeaders(product, githubToken);

  const res = await fetch(
    `https://api.github.com/repos/${product.githubRepo}/releases?per_page=100`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }

  const releases = (await res.json()) as GitHubRelease[];
  const filtered = releases.filter((r) =>
    r.tag_name.startsWith(product.tagPrefix),
  );

  const latestRelease = filtered[0];
  if (!latestRelease) return null;

  const version = latestRelease.tag_name.slice(product.tagPrefix.length);
  const latest: SimpleRelease = {
    version,
    notes: latestRelease.body ? stripDownloadSection(latestRelease.body) : "",
    pub_date: latestRelease.published_at || new Date().toISOString(),
  };

  const freshNotes = extractVersionNotes(filtered, product.tagPrefix);

  return { latest, freshNotes };
}

/** Aggregate release notes for all versions newer than currentVersion. */
export function aggregateNotes(
  allNotes: VersionNotes[],
  currentVersion: string,
): string {
  const relevant = allNotes.filter(
    (n) =>
      isValidVersion(n.version) &&
      compareVersions(n.version, currentVersion) > 0,
  );
  if (relevant.length === 0) return "";
  if (relevant.length === 1) return relevant[0].notes;
  return relevant.map((n) => `## ${n.version}\n${n.notes}`).join("\n\n");
}

export function findPlatformUpdate(
  latest: LatestJson,
  target: string,
  arch: string,
  notes: string,
): PlatformUpdate | null {
  const key = `${target}-${arch}`;
  const platform = latest.platforms[key];
  if (!platform) return null;

  return {
    version: latest.version,
    notes,
    pub_date: latest.pub_date,
    url: platform.url,
    signature: platform.signature,
  };
}
