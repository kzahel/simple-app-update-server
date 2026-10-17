import { describe, expect, it } from "vitest";
import { validateCompatibility } from "../src/compatibility.js";
import { findPlatformUpdate } from "../src/github.js";

const store = { floor: 1, target: 1, lineage: { 1: "a".repeat(64) } };
const release = {
  schemaVersion: 1,
  version: "0.4.121",
  identifier: "com.example.app",
  databases: {
    schemaVersion: 1,
    stores: { session: store, product: store, metrics: store },
  },
  platforms: {
    "darwin-aarch64": {
      url: "https://example.test/app",
      signature: "payload-signature",
    },
  },
};
const envelope = (data: unknown) => ({
  data: Buffer.from(JSON.stringify(data)).toString("base64"),
  signature: "signature",
});
describe("release compatibility transport", () => {
  it("preserves exact authenticated bytes in platform responses", () => {
    const compatibility = validateCompatibility(
      envelope(release),
      release.version,
    );
    const response = findPlatformUpdate(
      {
        version: release.version,
        notes: "",
        pub_date: "",
        platforms: release.platforms,
        compatibility,
      },
      "darwin",
      "aarch64",
      "",
    );
    expect(response?.compatibility).toEqual(compatibility);
  });
  it("rejects malformed, missing, oversized, identity mismatch and incomplete histories", () => {
    for (const value of [
      null,
      {},
      [],
      { data: "?", signature: "s" },
      { ...envelope(release), data: "a".repeat(49153) },
      envelope({ ...release, version: "0.1.0" }),
      envelope({ ...release, databases: { schemaVersion: 1, stores: {} } }),
      envelope({
        ...release,
        databases: {
          schemaVersion: 1,
          stores: {
            session: { ...store, target: 2 },
            product: store,
            metrics: store,
          },
        },
      }),
    ])
      expect(() => validateCompatibility(value, release.version)).toThrow();
  });
  it("leaves legacy platform response shape unchanged", () => {
    const response = findPlatformUpdate(
      {
        version: release.version,
        notes: "",
        pub_date: "",
        platforms: release.platforms,
      },
      "darwin",
      "aarch64",
      "",
    );
    expect(response).not.toHaveProperty("compatibility");
  });
});
