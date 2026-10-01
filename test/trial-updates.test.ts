import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadTrialUpdates,
  selectTrialUpdate,
  validateTrialUpdates,
} from "../src/trial-updates.js";

import { ID, trialFixture } from "./trial-fixture.js";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("pinned installation cohort", () => {
  it("selects only the exact product, channel and canonical opted-in installation", () => {
    const trial = validateTrialUpdates(trialFixture());
    expect(selectTrialUpdate(trial, "test-tauri", "stable", ID)).toBe(
      trial.candidate,
    );
    for (const id of [
      undefined,
      "",
      ID.toUpperCase(),
      ` ${ID}`,
      `${ID}, ${ID}`,
      [ID],
      "00000000-0000-0000-0000-000000000000",
    ]) {
      expect(
        selectTrialUpdate(trial, "test-tauri", "stable", id),
      ).toBeUndefined();
    }
    expect(
      selectTrialUpdate(trial, "another-product", "stable", ID),
    ).toBeUndefined();
    expect(
      selectTrialUpdate(trial, "test-tauri", "latest", ID),
    ).toBeUndefined();
    expect(
      selectTrialUpdate(undefined, "test-tauri", "stable", ID),
    ).toBeUndefined();
  });

  it("rejects unpinned identity, unsafe assets, malformed signatures and unbounded cohorts", () => {
    const cases = [
      (t: ReturnType<typeof trialFixture>) => {
        t.installationIds = [];
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.installationIds = Array(33).fill(ID);
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.installationIds = [ID, ID];
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.installationIds = ["not-an-installation"];
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.candidate.sourceSha = "latest";
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.candidate.version = "future";
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.candidate.attempt = 0;
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.candidate.pub_date = "invalid";
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.candidate.notes = "x".repeat(8193);
      },
      (t: ReturnType<typeof trialFixture>) => {
        t.candidate.platforms = {} as typeof t.candidate.platforms;
      },
    ];
    for (const mutate of cases) {
      const trial = trialFixture();
      mutate(trial);
      expect(() => validateTrialUpdates(trial)).toThrow();
    }
    for (const url of [
      "http://assets.example/a",
      "https://secret@assets.example/a",
      "https://assets.example/a?token=x",
      "https://assets.example/a#x",
    ]) {
      const trial = trialFixture();
      trial.candidate.platforms["linux-x86_64"].url = url;
      expect(() => validateTrialUpdates(trial)).toThrow();
    }
    for (const value of ["", "bogus", "A".repeat(4097)]) {
      const trial = trialFixture();
      trial.candidate.platforms["linux-x86_64"].signature = value;
      expect(() => validateTrialUpdates(trial)).toThrow();
    }
    const unknown = trialFixture();
    Object.assign(unknown.candidate.platforms, {
      "unsupported-x86_64": unknown.candidate.platforms["linux-x86_64"],
    });
    expect(() => validateTrialUpdates(unknown)).toThrow();
  });

  it("defaults disabled and fails closed without crashing ordinary service startup", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "trial-config-"));
    directories.push(dir);
    const file = join(dir, "trial.json");
    expect(loadTrialUpdates("")).toBeUndefined();
    expect(loadTrialUpdates(file)).toBeUndefined();
    for (const content of ["{", "null", "x".repeat(65537)]) {
      writeFileSync(file, content);
      expect(loadTrialUpdates(file)).toBeUndefined();
    }
    writeFileSync(file, JSON.stringify(trialFixture()));
    expect(loadTrialUpdates(file)?.candidate.version).toBe("0.3.0");
  });
});
