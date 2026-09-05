import type { ProductConfig } from "./products.js";

export interface ChannelConfig {
  displayName: string;
  tagPrefix: string;
  releaseKind: "release" | "prerelease";
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
