// ABOUTME: Registers usage channels and resolves models for footer polling and /usages.
// ABOUTME: Codex, SuperGrok, and OpenCode Go share the same footer/command pipeline.
import type { Model } from "@earendil-works/pi-ai";
import { codexChannel } from "./codex";
import { grokChannel } from "./grok";
import { opencodeGoChannel } from "./opencode-go";
import type { UsageChannel } from "./types";

export type { ChannelFetchResult, ChannelUsageView, ResolvedAuth, UsageChannel } from "./types";

export const CHANNELS: readonly UsageChannel[] = [codexChannel, grokChannel, opencodeGoChannel];

/** True when the channel needs an OAuth subscription session (default). */
export function channelRequiresOAuth(channel: UsageChannel): boolean {
  return channel.requiresOAuth !== false;
}

export function findChannelByProvider(provider: string | undefined): UsageChannel | undefined {
  if (!provider) return undefined;
  return CHANNELS.find((channel) => channel.matches(provider));
}

export function findChannelForModel(model: Model<any> | undefined): UsageChannel | undefined {
  return findChannelByProvider(model?.provider);
}

/** Pick any configured model for a channel so /usages can query it off the active model. */
export function resolveModelForChannel(
  channel: UsageChannel,
  available: readonly Model<any>[],
  current?: Model<any>,
): Model<any> | undefined {
  if (current && channel.matches(current.provider)) return current;
  return available.find((candidate) => channel.matches(candidate.provider));
}
