// ABOUTME: Registers usage channels and resolves the active one from model providers.
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

/** Prefer the current model channel; otherwise the first available matching model. */
export function resolveChannelAndModel(
	current: Model<any> | undefined,
	available: readonly Model<any>[],
): { channel: UsageChannel; model: Model<any> } | undefined {
	const currentChannel = findChannelForModel(current);
	if (current && currentChannel) {
		return { channel: currentChannel, model: current };
	}
	for (const channel of CHANNELS) {
		const model = available.find((candidate) => channel.matches(candidate.provider));
		if (model) return { channel, model };
	}
	return undefined;
}
