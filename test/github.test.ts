import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ArtifactManifestFetchResult,
  fetchArtifactManifestRelease,
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
      "artifact release version is invalid",
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
