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
