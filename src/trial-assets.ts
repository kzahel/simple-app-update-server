import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { TrialUpdates } from "./trial-updates.js";

export interface TrialAsset {
  file: string;
  size: number;
  url: URL;
}

/** Optional immutable local delivery. Validate every pinned byte before offering it. */
export function loadTrialAssets(
  trial: TrialUpdates | undefined,
  directory: string,
): TrialAsset[] {
  if (!trial || !directory) return [];
  const root = realpathSync(directory);
  const assets: TrialAsset[] = [];
  for (const asset of Object.values(trial.candidate.platforms)) {
    const url = new URL(asset.url);
    const name = decodeURIComponent(basename(url.pathname));
    if (!name || name === "." || name === ".." || /[/\\]/.test(name))
      throw new Error("Invalid trial asset filename");
    const file = join(root, name);
    if (
      realpathSync(file) !== file ||
      assets.some((existing) => existing.url.href === url.href)
    ) {
      throw new Error(
        "Trial asset must be a unique regular file inside the configured directory",
      );
    }
    const descriptor = openSync(file, "r");
    try {
      const info = fstatSync(descriptor);
      if (
        !info.isFile() ||
        info.size !== asset.size ||
        info.size > 512 * 1024 * 1024
      )
        throw new Error("Trial asset size mismatch");
      const hash = createHash("sha256");
      const buffer = Buffer.alloc(64 * 1024);
      let total = 0;
      while (total <= asset.size) {
        const count = readSync(
          descriptor,
          buffer,
          0,
          Math.min(buffer.length, asset.size + 1 - total),
          null,
        );
        if (!count) break;
        total += count;
        hash.update(buffer.subarray(0, count));
      }
      if (total !== asset.size || hash.digest("hex") !== asset.sha256)
        throw new Error("Trial asset hash mismatch");
    } finally {
      closeSync(descriptor);
    }
    assets.push({ file, size: asset.size, url });
  }
  return assets;
}

export function findTrialAsset(
  assets: TrialAsset[],
  host: string,
  requestPath: string,
): TrialAsset | undefined {
  return assets.find(
    (asset) => asset.url.host === host && asset.url.pathname === requestPath,
  );
}
