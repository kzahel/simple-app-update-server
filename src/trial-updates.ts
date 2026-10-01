import { closeSync, openSync, readSync } from "node:fs";
import type { LatestJson } from "./github.js";
import { isValidVersion } from "./version.js";

const MAX_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TARGETS = new Set([
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-aarch64",
  "linux-x86_64",
  "windows-x86_64",
]);

export interface TrialUpdates {
  schemaVersion: 1;
  productId: string;
  channel: string;
  installationIds: string[];
  candidate: LatestJson & {
    sourceSha: string;
    runId: string;
    attempt: number;
    platforms: Record<
      string,
      { url: string; signature: string; size: number; sha256: string }
    >;
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

export function validateTrialUpdates(value: unknown): TrialUpdates {
  const trial = object(value);
  if (
    trial.schemaVersion !== 1 ||
    !text(trial.productId, 32) ||
    !/^[a-z][a-z0-9-]*$/.test(trial.productId) ||
    !text(trial.channel, 32) ||
    !/^[a-z][a-z0-9-]*$/.test(trial.channel)
  ) {
    throw new Error("Invalid trial product/channel/schema");
  }
  const ids = trial.installationIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 32 ||
    ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("Trial requires 1–32 unique canonical installation UUIDs");
  }
  const candidate = object(trial.candidate);
  if (
    !text(candidate.sourceSha, 40) ||
    !/^[0-9a-f]{40}$/.test(candidate.sourceSha) ||
    !text(candidate.runId, 24) ||
    !/^[1-9][0-9]*$/.test(candidate.runId) ||
    !Number.isSafeInteger(candidate.attempt) ||
    (candidate.attempt as number) < 1 ||
    !text(candidate.version, 32) ||
    !isValidVersion(candidate.version) ||
    typeof candidate.notes !== "string" ||
    candidate.notes.length > 8192 ||
    !text(candidate.pub_date, 40) ||
    !Number.isFinite(Date.parse(candidate.pub_date))
  ) {
    throw new Error("Invalid pinned candidate identity/metadata");
  }
  const platforms = object(candidate.platforms);
  if (
    Object.keys(platforms).length === 0 ||
    Object.keys(platforms).length > 5
  ) {
    throw new Error("Trial requires 1–5 supported updater targets");
  }
  for (const [target, raw] of Object.entries(platforms)) {
    const asset = object(raw);
    if (
      !TARGETS.has(target) ||
      !text(asset.url, 2048) ||
      !text(asset.signature, 4096) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(asset.signature) ||
      !Number.isSafeInteger(asset.size) ||
      (asset.size as number) < 1 ||
      !text(asset.sha256, 64) ||
      !/^[0-9a-f]{64}$/.test(asset.sha256)
    ) {
      throw new Error("Invalid pinned trial asset");
    }
    const url = new URL(asset.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Trial assets require credential-free HTTPS URLs");
    }
    const bytes = Buffer.from(asset.signature, "base64");
    if (
      bytes.toString("base64") !== asset.signature ||
      !bytes.toString("utf8").startsWith("untrusted comment:") ||
      Buffer.from(bytes.toString("utf8").split("\n")[1] ?? "", "base64")
        .length !== 74
    ) {
      throw new Error(
        "Trial asset is missing a Tauri/minisign signature envelope",
      );
    }
  }
  return value as TrialUpdates;
}

/** Bounded local configuration; a bad trial never takes ordinary updating down. */
export function loadTrialUpdates(file: string): TrialUpdates | undefined {
  if (!file) return undefined;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, "r");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_BYTES)
      throw new Error("Trial configuration exceeds 64 KiB");
    return validateTrialUpdates(
      JSON.parse(buffer.subarray(0, length).toString("utf8")),
    );
  } catch {
    console.error(
      "Trial updates disabled: unavailable or invalid configuration",
    );
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** No IP fallback, query override, or mutation of the ordinary release cache. */
export function selectTrialUpdate(
  trial: TrialUpdates | undefined,
  productId: string,
  channel: string,
  installationId: string | string[] | undefined,
): TrialUpdates["candidate"] | undefined {
  if (
    !trial ||
    trial.productId !== productId ||
    trial.channel !== channel ||
    typeof installationId !== "string" ||
    !UUID.test(installationId) ||
    !trial.installationIds.includes(installationId)
  )
    return undefined;
  return trial.candidate;
}
