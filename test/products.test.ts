import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: { productsConfig: "products.sample.json" },
}));

import { validateProduct } from "../src/products.js";

const product = {
  id: "canary",
  displayName: "Canary",
  githubRepo: "owner/repo",
  hostnames: [],
  tagPrefix: "desktop-v",
  tauriUpdates: true,
};
const stable = {
  displayName: "Stable",
  tagPrefix: "desktop-v",
  releaseKind: "release",
};
describe("channel registry validation", () => {
  it("accepts legacy and additive registries", () => {
    expect(validateProduct(product, "fixture")).toEqual(product);
    expect(
      validateProduct(
        {
          ...product,
          channels: {
            stable,
            beta: {
              displayName: "Beta",
              tagPrefix: "beta-v",
              releaseKind: "prerelease",
            },
          },
        },
        "fixture",
      ).channels?.beta.displayName,
    ).toBe("Beta");
  });
  it("rejects registries that alter legacy selection or have invalid rules", () => {
    for (const channels of [
      null,
      [],
      {},
      { stable: { ...stable, tagPrefix: "changed" } },
      { stable: { ...stable, releaseKind: "prerelease" } },
      { stable, Latest: stable },
      { stable, latest: { ...stable, displayName: "" } },
      { stable, latest: { ...stable, releaseKind: "anything" } },
    ]) {
      expect(() =>
        validateProduct({ ...product, channels }, "fixture"),
      ).toThrow();
    }
    expect(() =>
      validateProduct(
        { ...product, tauriUpdates: false, channels: { stable } },
        "fixture",
      ),
    ).toThrow();
  });
});

describe("installer download configuration", () => {
  it("accepts platform ids with asset-name patterns", () => {
    const downloads = { "macos-arm64": { asset: "App_*_aarch64.dmg" } };
    expect(
      validateProduct({ ...product, downloads }, "fixture").downloads,
    ).toEqual(downloads);
  });

  it("rejects invalid or non-Tauri download configuration", () => {
    for (const downloads of [
      null,
      {},
      [],
      { "Mac OS": { asset: "App_*.dmg" } },
      { macos: { asset: "" } },
      { macos: { asset: "../App_*.dmg" } },
    ]) {
      expect(() =>
        validateProduct({ ...product, downloads }, "fixture"),
      ).toThrow();
    }
    expect(() =>
      validateProduct(
        {
          ...product,
          tauriUpdates: false,
          downloads: { macos: { asset: "App_*.dmg" } },
        },
        "fixture",
      ),
    ).toThrow();
  });
});

describe("package marker validation", () => {
  it("accepts exact asset names and rejects paths, empty and unbounded input", () => {
    const configured = (requiredAsset: unknown) => ({
      ...product,
      channels: { stable: { ...stable, requiredAsset } },
    });
    expect(
      validateProduct(configured("JSTorrent_x64.app.tar.gz"), "fixture")
        .channels?.stable.requiredAsset,
    ).toBe("JSTorrent_x64.app.tar.gz");
    for (const invalid of [
      null,
      7,
      "",
      "../App.tar.gz",
      "a/b",
      "a\\b",
      "App*",
      "x".repeat(201),
    ]) {
      expect(() => validateProduct(configured(invalid), "fixture")).toThrow(
        "invalid channel rule",
      );
    }
  });
});

it("bounds and validates optional automatic target allowlists",()=>{
 const registry=(automaticInstallTargets:unknown)=>({...product,channels:{stable:{...stable,automaticInstall:true,automaticInstallTargets}}});
 expect(validateProduct(registry(['darwin-aarch64']),'fixture').channels?.stable.automaticInstallTargets).toEqual(['darwin-aarch64']);
 for(const targets of [null,'darwin-aarch64',[null],['darwin/aarch64'],['darwin-aarch64','darwin-aarch64'],Array.from({length:33},(_,i)=>'linux-arch'+i)])expect(()=>validateProduct(registry(targets),'fixture')).toThrow();
});
