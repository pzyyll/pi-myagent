// ABOUTME: Registers usage channels and resolves models for footer polling and /usages.
// ABOUTME: Codex and SuperGrok share the same footer/command pipeline through this registry.
import type { Model } from "@earendil-works/pi-ai";
import { codexChannel } from "./codex";
import { grokChannel } from "./grok";
import type { UsageChannel } from "./types";

export type { ChannelFetchResult, ChannelUsageView, ResolvedAuth, UsageChannel } from "./types";

export const CHANNELS: readonly UsageChannel[] = [codexChannel, grokChannel];

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
