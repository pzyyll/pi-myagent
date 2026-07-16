// ABOUTME: Shared multi-channel usage contracts for footer polling and /usages.
// ABOUTME: Each provider implements fetch + render behind one UsageChannel interface.
import type { Model } from "@earendil-works/pi-ai";
import type { ThemeFg, UsageWindow } from "../shared";

export interface ResolvedAuth {
	readonly apiKey: string | undefined;
	readonly headers: Record<string, string>;
}

export type ChannelFetchResult =
	| { ok: true; view: ChannelUsageView }
	| { ok: false; error: string; aborted?: boolean };

export interface ChannelUsageView {
	readonly channelId: string;
	readonly brand: string;
	readonly windows: readonly UsageWindow[];
	readonly usable: boolean;
	renderDetails(fg: ThemeFg): string[];
	renderStatus(fg: ThemeFg): string;
}

export interface ChannelFetchArgs {
	readonly model: Model<any>;
	readonly auth: ResolvedAuth;
	readonly signal: AbortSignal;
	readonly shouldContinue: () => boolean;
	readonly now: number;
	readonly fetchImpl?: typeof fetch;
}

export interface UsageChannel {
	readonly id: string;
	readonly brand: string;
	readonly providers: readonly string[];
	matches(provider: string): boolean;
	fetch(args: ChannelFetchArgs): Promise<ChannelFetchResult>;
}
