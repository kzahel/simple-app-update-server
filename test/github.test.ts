import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ArtifactManifestFetchResult,
  fetchArtifactManifestRelease,
  fetchSimpleReleases,
  fetchTauriReleases,
} from "../src/github.js";
import type { ProductConfig } from "../src/products.js";

const PRODUCT: ProductConfig = {
  id: "crostini",
  displayName: "200 OK ChromeOS Linux",
  hostnames: ["updates.example.test"],
  githubRepo: "owner/repository",
  tagPrefix: "crostini-v",
  tauriUpdates: false,
  artifactManifest: {
    manifestAsset: "release.manifest",
    signatureAsset: "release.manifest.minisig",
  },
};

const TAURI_PRODUCT: ProductConfig = {
  id: "desktop",
  displayName: "Desktop",
  hostnames: ["updates.example.test"],
  githubRepo: "owner/repository",
  tagPrefix: "desktop-v",
  tauriUpdates: true,
};

function githubRelease(version = "0.1.0") {
  return {
    tag_name: `crostini-v${version}`,
    published_at: "2026-08-02T00:00:00.000Z",
    assets: [
      {
        name: "release.manifest",
        browser_download_url: "https://downloads.test/release.manifest",
      },
      {
        name: "release.manifest.minisig",
        browser_download_url: "https://downloads.test/release.manifest.minisig",
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchArtifactManifestRelease", () => {
  it("returns the exact manifest and signature bytes from one matching release", async () => {
    const manifest = Buffer.from([0, 1, 2, 10, 255]);
    const signature = Buffer.from("signature\n", "utf8");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([githubRelease()]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(manifest, { status: 200 }))
      .mockResolvedValueOnce(new Response(signature, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = (await fetchArtifactManifestRelease(
      PRODUCT,
      "token",
    )) as ArtifactManifestFetchResult;

    expect(Buffer.from(result.latest.manifest, "base64")).toEqual(manifest);
    expect(Buffer.from(result.latest.signature, "base64")).toEqual(signature);
    expect(result.latest.version).toBe("0.1.0");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails closed for malformed versions and oversized metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify([githubRelease("not-semver")]), {
          status: 200,
        }),
      ),
    );
    await expect(fetchArtifactManifestRelease(PRODUCT, "")).rejects.toThrow(
      "release version is invalid",
    );

    const oversized = Buffer.alloc(128 * 1024 + 1);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { ...githubRelease("0.2.0"), draft: true },
              githubRelease(),
            ]),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(oversized, { status: 200 }))
        .mockResolvedValueOnce(new Response("signature", { status: 200 })),
    );
    await expect(fetchArtifactManifestRelease(PRODUCT, "")).rejects.toThrow(
      "invalid size",
    );
  });
});

describe("release selection", () => {
  it("selects the highest public semantic Tauri release, not API list order", async () => {
    const releases = [
      {
        tag_name: "desktop-v0.1.11",
        draft: true,
        assets: [],
      },
      {
        tag_name: "desktop-v0.1.6",
        body: "older",
        assets: [
          {
            name: "latest.json",
            browser_download_url: "https://downloads.test/0.1.6.json",
          },
        ],
      },
      {
        tag_name: "desktop-v0.2.0",
        prerelease: true,
        assets: [],
      },
      {
        tag_name: "desktop-v0.1.10",
        body: "newer",
        assets: [
          {
            name: "latest.json",
            browser_download_url: "https://downloads.test/0.1.10.json",
          },
        ],
      },
    ];
    const latest = {
      version: "0.1.10",
      notes: "newer",
      pub_date: "2026-08-04T00:00:00.000Z",
      platforms: {},
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(releases), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(latest), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTauriReleases(TAURI_PRODUCT, "token");

    expect(result?.latest.version).toBe("0.1.10");
    expect(result?.freshNotes.map((entry) => entry.version)).toEqual([
      "0.1.10",
      "0.1.6",
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://downloads.test/0.1.10.json",
      expect.any(Object),
    );
  });

  it("selects the highest public semantic simple release", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { tag_name: "v1.9.0", assets: [] },
            { tag_name: "v1.10.0", assets: [] },
          ]),
          { status: 200 },
        ),
      ),
    );

    const result = await fetchSimpleReleases(
      { ...TAURI_PRODUCT, tagPrefix: "v", tauriUpdates: false },
      "",
    );

    expect(result?.latest.version).toBe("1.10.0");
  });
});
