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

export interface ArtifactManifestRelease {
  version: string;
  pub_date: string;
  /** Exact release asset bytes encoded for transport without reserialization. */
  manifest: string;
  /** Exact detached-signature asset bytes encoded for transport. */
  signature: string;
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

export interface ArtifactManifestFetchResult {
  latest: ArtifactManifestRelease;
}

interface GitHubRelease {
  tag_name: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

const MAX_ARTIFACT_MANIFEST_BYTES = 128 * 1024;

async function fetchReleaseAsset(
  product: ProductConfig,
  url: string,
): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": `${product.id}-update-server` },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch artifact manifest asset: ${response.status}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_ARTIFACT_MANIFEST_BYTES) {
    throw new Error(
      `Artifact manifest asset has invalid size: ${bytes.length}`,
    );
  }
  return bytes;
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

/** Fetch an exact manifest/signature pair from one immutable GitHub release. */
export async function fetchArtifactManifestRelease(
  product: ProductConfig,
  githubToken: string,
): Promise<ArtifactManifestFetchResult | null> {
  const artifactManifest = product.artifactManifest;
  if (!artifactManifest) {
    throw new Error(`${product.id} has no artifactManifest configuration`);
  }
  const headers = makeHeaders(product, githubToken);
  const response = await fetch(
    `https://api.github.com/repos/${product.githubRepo}/releases?per_page=100`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub API returned ${response.status}: ${response.statusText}`,
    );
  }

  const releases = (await response.json()) as GitHubRelease[];
  const latestRelease = releases.find(
    (release) =>
      !release.draft &&
      !release.prerelease &&
      release.tag_name.startsWith(product.tagPrefix),
  );
  if (!latestRelease) return null;

  const version = latestRelease.tag_name.slice(product.tagPrefix.length);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(
      `${latestRelease.tag_name}: artifact release version is invalid`,
    );
  }
  const manifestAsset = latestRelease.assets.find(
    (asset) => asset.name === artifactManifest.manifestAsset,
  );
  const signatureAsset = latestRelease.assets.find(
    (asset) => asset.name === artifactManifest.signatureAsset,
  );
  if (!manifestAsset || !signatureAsset) return null;

  const [manifest, signature] = await Promise.all([
    fetchReleaseAsset(product, manifestAsset.browser_download_url),
    fetchReleaseAsset(product, signatureAsset.browser_download_url),
  ]);
  return {
    latest: {
      version,
      pub_date: latestRelease.published_at || new Date().toISOString(),
      manifest: manifest.toString("base64"),
      signature: signature.toString("base64"),
    },
  };
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
