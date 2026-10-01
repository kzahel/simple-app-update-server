import { createHash } from "node:crypto";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { findTrialAsset, loadTrialAssets } from "../src/trial-assets.js";
import { validateTrialUpdates } from "../src/trial-updates.js";
import { trialFixture } from "./trial-fixture.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it("pins exact local bytes and exact hostname/path with no browse or query override", () => {
  const dir = mkdtempSync(join(tmpdir(), "trial-assets-"));
  dirs.push(dir);
  const bytes = Buffer.from("owned updater payload");
  const fixture = trialFixture();
  Object.assign(fixture.candidate.platforms["linux-x86_64"], {
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const trial = validateTrialUpdates(fixture);
  const file = join(dir, "trial.AppImage");
  writeFileSync(file, bytes);
  const assets = loadTrialAssets(trial, dir);
  expect(
    findTrialAsset(assets, "assets.example", "/trial.AppImage")?.file,
  ).toBe(realpathSync(file));
  for (const path of [
    "/trial.AppImage?x=1",
    "/../trial.AppImage",
    "/",
    "/trial.json",
  ]) {
    expect(findTrialAsset(assets, "assets.example", path)).toBeUndefined();
  }
  expect(
    findTrialAsset(assets, "other.example", "/trial.AppImage"),
  ).toBeUndefined();
  expect(loadTrialAssets(undefined, dir)).toEqual([]);
  expect(loadTrialAssets(trial, "")).toEqual([]);
  writeFileSync(file, "x".repeat(bytes.length));
  expect(() => loadTrialAssets(trial, dir)).toThrow("hash mismatch");
  writeFileSync(file, "short");
  expect(() => loadTrialAssets(trial, dir)).toThrow("size mismatch");
  rmSync(file);
  symlinkSync(join(dir, "outside"), file);
  writeFileSync(join(dir, "outside"), bytes);
  expect(() => loadTrialAssets(trial, dir)).toThrow();
});
