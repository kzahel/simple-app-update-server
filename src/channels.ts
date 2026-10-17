import type { ProductConfig } from "./products.js";

export interface ChannelConfig {
  displayName: string;
  tagPrefix: string;
  releaseKind: "release" | "prerelease";
  /** Exact asset identifying a package family when tag prefixes overlap. */
  requiredAsset?: string;
  /** Rollout permission; capable native clients still enforce opt-out and admission. */
  automaticInstall?: boolean;
  /** Optional exact updater targets qualified for unattended installation. */
  automaticInstallTargets?: string[];
}

export const CHANNEL_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function channelsFor(
  product: ProductConfig,
): Record<string, ChannelConfig> {
  return (
    product.channels ?? {
      stable: {
        displayName: "Stable",
        tagPrefix: product.tagPrefix,
        releaseKind: "release",
      },
    }
  );
}

export function selectChannel(
  product: ProductConfig,
  params: URLSearchParams,
): string {
  const values = params.getAll("channel");
  const channel = values.length === 0 ? "stable" : values[0];
  if (
    values.length > 1 ||
    !CHANNEL_ID.test(channel) ||
    !Object.hasOwn(channelsFor(product), channel)
  ) {
    throw new Error(
      `Unsupported or malformed update channel: ${values.join(",")}`,
    );
  }
  return channel;
}

export function stateKey(product: ProductConfig, channel: string): string {
  return channel === "stable" ? product.id : `${product.id}:${channel}`;
}

/** Isolate marked rules from any unqualified persisted candidate or notes. */
export function channelCacheNamespace(
  channel: string,
  rule: ChannelConfig,
): string {
  if (channel === "stable" && rule.requiredAsset === undefined) return "";
  const identity =
    `${rule.releaseKind}-${rule.tagPrefix}` +
    (rule.requiredAsset === undefined ? "" : `-asset-${rule.requiredAsset}`);
  return `/channels/${channel}/${encodeURIComponent(identity)}`;
}

/** Missing permission fails closed; a target list can narrow an enabled channel. */
export function automaticInstallAllowed(rule: ChannelConfig, target: string, arch: string): boolean {
  return rule.automaticInstall === true &&
    (rule.automaticInstallTargets === undefined || rule.automaticInstallTargets.includes(`${target}-${arch}`));
}
