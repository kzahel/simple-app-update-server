import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../src/cache.js";
import { channelsFor, selectChannel } from "../src/channels.js";
import { fetchTauriReleases } from "../src/github.js";
import type { ProductConfig } from "../src/products.js";
import { compareVersions } from "../src/version.js";

const product: ProductConfig = {
  id: "canary",
  displayName: "Canary",
  githubRepo: "owner/repo",
  hostnames: [],
  tagPrefix: "desktop-v",
  tauriUpdates: true,
  channels: {
    stable: {
      displayName: "Stable",
      tagPrefix: "desktop-v",
      releaseKind: "release",
    },
    latest: {
      displayName: "Latest",
      tagPrefix: "desktop-latest-v",
      releaseKind: "prerelease",
    },
  },
};
const release = (tag: string, prerelease = false, draft = false) => ({
  tag_name: tag,
  prerelease,
  draft,
  body: tag,
  assets: [
    {
      name: "latest.json",
      browser_download_url: `https://downloads.test/${tag}.json`,
    },
  ],
});
afterEach(() => vi.unstubAllGlobals());

describe("channel contract", () => {
  it("defaults legacy products and requests to Stable, rejects explicit unknowns", () => {
    const legacy = { ...product, channels: undefined };
    expect(Object.keys(channelsFor(legacy))).toEqual(["stable"]);
    expect(selectChannel(product, new URLSearchParams())).toBe("stable");
    expect(selectChannel(product, new URLSearchParams("channel=latest"))).toBe(
      "latest",
    );
    for (const query of [
      "channel=",
      "channel=Latest",
      "channel=beta",
      "channel=../latest",
      "channel=stable&channel=latest",
      "channel=__proto__",
    ]) {
      expect(() =>
        selectChannel(product, new URLSearchParams(query)),
      ).toThrow();
    }
    expect(() =>
      selectChannel(legacy, new URLSearchParams("channel=latest")),
    ).toThrow();
  });
  it.each([
    ["stable", "0.2.0"],
    ["latest", "0.3.1001"],
  ])("isolates %s selection and notes regardless of publication order", async (channel, version) => {
    const releases = [
      release("desktop-latest-v0.3.999", true),
      release("desktop-v0.2.0"),
      release("desktop-latest-v0.3.1001", true),
      release("desktop-latest-v0.9.9999", true, true),
      release("desktop-beta-v9.0.0", true),
      release("desktop-v8.0.0", true),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(releases))
      .mockResolvedValueOnce(
        Response.json({ version, platforms: {}, notes: "" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchTauriReleases(product, "", channel);
    expect(result?.latest.version).toBe(version);
    expect(result?.freshNotes.map((n) => n.version)).toEqual(
      channel === "stable" ? ["0.2.0"] : ["0.3.1001", "0.3.999"],
    );
  });
  it("finds Stable after a full page of preview builds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          Array.from({ length: 100 }, (_, i) =>
            release(`desktop-latest-v0.3.${i}`, true),
          ),
        ),
      )
      .mockResolvedValueOnce(Response.json([release("desktop-v0.2.0")]))
      .mockResolvedValueOnce(
        Response.json({ version: "0.2.0", platforms: {} }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchTauriReleases(product, ""))?.latest.version).toBe(
      "0.2.0",
    );
    expect(fetchMock.mock.calls[1][0]).toContain("&page=2");
  });
  it("fails closed when the tagged version and metadata disagree", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json([release("desktop-latest-v0.3.101", true)]),
        )
        .mockResolvedValueOnce(
          Response.json({ version: "9.0.0", platforms: {} }),
        ),
    );
    await expect(fetchTauriReleases(product, "", "latest")).rejects.toThrow(
      "identity mismatch",
    );
  });
  it("keeps the newer cached candidate after a regressing GitHub view", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ version: "0.3.201" })
      .mockResolvedValueOnce({ version: "0.3.101" });
    const cache = new Cache<{ version: string }>(
      fetcher,
      0,
      undefined,
      (next, prev) => compareVersions(next.version, prev.version) >= 0,
    );
    expect((await cache.get())?.version).toBe("0.3.201");
    expect((await cache.get())?.version).toBe("0.3.201");
  });
});

describe("channel cache reload", () => {
  it("isolates persisted fallback and never imports Stable into Latest", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "channels-cache-"));
    try {
      const stablePath = path.join(directory, "latest-cache.json");
      const latestPath = path.join(
        directory,
        "channels",
        "latest",
        "latest-cache.json",
      );
      fs.writeFileSync(stablePath, JSON.stringify({ version: "0.2.0" }));
      const unavailable = async () => {
        throw new Error("GitHub unavailable");
      };
      const silent = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(
          (
            await new Cache<{ version: string }>(
              unavailable,
              0,
              stablePath,
            ).get()
          )?.version,
        ).toBe("0.2.0");
        expect(
          await new Cache<{ version: string }>(
            unavailable,
            0,
            latestPath,
          ).get(),
        ).toBeNull();
        await new Cache(
          async () => ({ version: "0.3.101" }),
          0,
          latestPath,
        ).get();
        expect(
          (
            await new Cache<{ version: string }>(
              unavailable,
              0,
              latestPath,
            ).get()
          )?.version,
        ).toBe("0.3.101");
        expect(
          (
            await new Cache<{ version: string }>(
              unavailable,
              0,
              stablePath,
            ).get()
          )?.version,
        ).toBe("0.2.0");
      } finally {
        silent.mockRestore();
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
