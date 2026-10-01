export const ID = "01234567-89ab-4cde-8fab-0123456789ab";
export function trialFixture() {
  const signature = Buffer.from(
    `untrusted comment: test\n${Buffer.alloc(74).toString("base64")}\ntrusted comment: test\nAAAA\n`,
  ).toString("base64");
  return {
    schemaVersion: 1,
    productId: "test-tauri",
    channel: "stable",
    installationIds: [ID],
    candidate: {
      sourceSha: "a".repeat(40),
      runId: "1234",
      attempt: 1,
      version: "0.3.0",
      notes: "Owned upgrade trial",
      pub_date: "2026-10-01T00:00:00Z",
      platforms: {
        "linux-x86_64": {
          url: "https://assets.example/trial.AppImage",
          signature,
          size: 42,
          sha256: "b".repeat(64),
        },
      },
    },
  };
}
