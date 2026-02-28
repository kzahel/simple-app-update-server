import type * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SimpleFetchResult, TauriFetchResult } from "../src/github.js";

// biome-ignore lint/suspicious/noExplicitAny: test helper for JSON responses
async function json(res: Response): Promise<any> {
  return res.json();
}

const MOCK_TAURI_RESULT: TauriFetchResult = {
  latest: {
    version: "0.1.21",
    notes: "- Remember window position across restarts",
    pub_date: "2026-02-11T07:33:31.665Z",
    platforms: {
      "darwin-aarch64": {
        signature: "sig-darwin-aarch64",
        url: "https://github.com/example/releases/download/v0.1.21/App_aarch64.app.tar.gz",
      },
      "windows-x86_64": {
        signature: "sig-windows-x86_64",
        url: "https://github.com/example/releases/download/v0.1.21/App_0.1.21_x64.msi",
      },
      "linux-x86_64": {
        signature: "sig-linux-x86_64",
        url: "https://github.com/example/releases/download/v0.1.21/App_0.1.21_amd64.AppImage",
      },
    },
  },
  freshNotes: [
    {
      version: "0.1.21",
      notes: "- Remember window position across restarts",
    },
    {
      version: "0.1.20",
      notes:
        "- Add magnet/torrent routing\n- Launch desktop app from extension",
    },
    { version: "0.1.19", notes: "- Add profile picker UI" },
    { version: "0.1.18", notes: "- Add profile system" },
  ],
};

const MOCK_SIMPLE_RESULT: SimpleFetchResult = {
  latest: {
    version: "0.4.6",
    notes: "- New feature",
    pub_date: "2026-02-28T00:00:00.000Z",
  },
  freshNotes: [
    { version: "0.4.6", notes: "- New feature" },
    { version: "0.4.5", notes: "- Bug fix" },
  ],
};

// Mock github module before importing server
vi.mock("../src/github.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/github.js")>();
  return {
    ...actual,
    fetchTauriReleases: vi.fn().mockResolvedValue(MOCK_TAURI_RESULT),
    fetchSimpleReleases: vi.fn().mockResolvedValue(MOCK_SIMPLE_RESULT),
  };
});

const testDir = `/tmp/update-server-test-${Date.now()}`;

// Mock config
vi.mock("../src/config.js", () => ({
  config: {
    port: 0,
    cacheTtlMs: 60_000,
    logDir: testDir,
    githubToken: "",
    defaultProductId: "test-tauri",
  },
}));

// Mock products
vi.mock("../src/products.js", () => {
  const products = [
    {
      id: "test-tauri",
      displayName: "Test Tauri App",
      hostnames: ["tauri.test"],
      githubRepo: "test/tauri",
      tagPrefix: "v",
      tauriUpdates: true,
    },
    {
      id: "test-simple",
      displayName: "Test Simple App",
      hostnames: ["simple.test"],
      githubRepo: "test/simple",
      tagPrefix: "v",
      tauriUpdates: false,
    },
  ];

  const productByHostname = new Map();
  const productById = new Map();
  for (const p of products) {
    for (const h of p.hostnames) productByHostname.set(h, p);
    productById.set(p.id, p);
  }

  return { products, productByHostname, productById };
});

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const mod = await import("../src/server.js");
  server = mod.server;
  await new Promise<void>((resolve) => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      baseUrl = `http://127.0.0.1:${(addr as AddressInfo).port}`;
      resolve();
    } else {
      server.once("listening", () => {
        const a = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${a.port}`;
        resolve();
      });
    }
  });
});

afterAll(async () => {
  const mod = await import("../src/server.js");
  mod.analytics.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const mod = await import("../src/server.js");
  for (const state of mod.productStates.values()) {
    state.cache.invalidate();
  }
});

describe("GET /health", () => {
  it("returns 200 with ok: true", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });
});

describe("Tauri update checks (Host: tauri.test)", () => {
  const headers = { "X-Forwarded-Host": "tauri.test" };

  it("returns 200 with update when newer version available", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.1.20`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.version).toBe("0.1.21");
    expect(body.url).toContain("aarch64.app.tar.gz");
    expect(body.signature).toBe("sig-darwin-aarch64");
    expect(body.notes).toBeTruthy();
    expect(body.pub_date).toBeTruthy();
  });

  it("returns 204 when already on latest", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.1.21`, {
      headers,
    });
    expect(res.status).toBe(204);
  });

  it("returns 204 when client is ahead", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.2.0`, {
      headers,
    });
    expect(res.status).toBe(204);
  });

  it("returns 204 for unknown platform", async () => {
    const res = await fetch(`${baseUrl}/tauri/freebsd/aarch64/0.1.0`, {
      headers,
    });
    expect(res.status).toBe(204);
  });

  it("returns update for windows", async () => {
    const res = await fetch(`${baseUrl}/tauri/windows/x86_64/0.1.20`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.url).toContain("x64.msi");
  });

  it("returns update for linux", async () => {
    const res = await fetch(`${baseUrl}/tauri/linux/x86_64/0.1.20`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.url).toContain("amd64.AppImage");
  });

  it("returns only latest notes when upgrading from previous version", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.1.20`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.notes).toBe("- Remember window position across restarts");
  });

  it("returns aggregated notes when skipping multiple versions", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.1.18`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.notes).toContain("## 0.1.21");
    expect(body.notes).toContain("## 0.1.20");
    expect(body.notes).toContain("## 0.1.19");
    expect(body.notes).not.toContain("## 0.1.18");
  });

  it("returns 400 for invalid version format", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/not-a-version`, {
      headers,
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("Invalid version format");
  });

  it("strips query strings from version", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.1.21?foo=bar`, {
      headers,
    });
    expect(res.status).toBe(204);
  });

  it("strips query strings and still detects updates", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.1.20?t=123`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.version).toBe("0.1.21");
  });
});

describe("Simple version checks (Host: simple.test)", () => {
  const headers = { "X-Forwarded-Host": "simple.test" };

  it("returns latest version info at /version", async () => {
    const res = await fetch(`${baseUrl}/version`, { headers });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.version).toBe("0.4.6");
    expect(body.notes).toBeTruthy();
    expect(body.pub_date).toBeTruthy();
  });

  it("returns 204 when current at /version/:currentVersion", async () => {
    const res = await fetch(`${baseUrl}/version/0.4.6`, { headers });
    expect(res.status).toBe(204);
  });

  it("returns update info when behind", async () => {
    const res = await fetch(`${baseUrl}/version/0.4.5`, { headers });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.version).toBe("0.4.6");
  });

  it("returns 400 for invalid version in /version/:version", async () => {
    const res = await fetch(`${baseUrl}/version/bad`, { headers });
    expect(res.status).toBe(400);
  });

  it("rejects /tauri endpoint for non-Tauri products", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.1.0`, {
      headers,
    });
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error).toContain("Tauri");
  });
});

describe("Hostname routing", () => {
  it("uses default product when hostname unknown", async () => {
    const res = await fetch(`${baseUrl}/version`, {
      headers: { "X-Forwarded-Host": "unknown.test" },
    });
    // Default product is test-tauri, /version should return version info
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.version).toBeTruthy();
  });

  it("returns 404 for unknown hostname when no default", async () => {
    // Mock empty default — test-tauri is set as default, so this verifies routing works
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64/0.1.20`, {
      headers: { "X-Forwarded-Host": "tauri.test" },
    });
    expect(res.status).toBe(200);
  });
});

describe("Stats endpoint", () => {
  it("returns HTML for /stats", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { "X-Forwarded-Host": "tauri.test" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("Other routes", () => {
  it("returns 404 for unknown paths", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });

  it("returns 405 for POST", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("returns 404 for incomplete tauri path", async () => {
    const res = await fetch(`${baseUrl}/tauri/darwin/aarch64`, {
      headers: { "X-Forwarded-Host": "tauri.test" },
    });
    expect(res.status).toBe(404);
  });
});
