import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PACKAGE_ROOT = dirname(require.resolve("../package.json"));
const RULES_FILE = join(PACKAGE_ROOT, "rules", "system-append.gpt55.md");

let cachedRules: string | null | undefined;

function loadRules(): string | null {
	if (cachedRules !== undefined) return cachedRules;
	try {
		cachedRules = readFileSync(RULES_FILE, "utf8").trim() || null;
	} catch {
		cachedRules = null;
	}
	return cachedRules;
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const rules = loadRules();
		if (!rules) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n<!-- > Dev Instructions -->\n${rules}\n<!-- Dev Instructions -->`,
		};
	});
}
