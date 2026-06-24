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
	return `<!-- Dev Instructions -->
${cachedRules}
<!-- Dev Instructions -->`;
}

export default function (pi: ExtensionAPI) {
	const marker = "<project_context>";

	pi.on("before_agent_start", (event) => {
		const rules = loadRules();
		if (!rules) return;

		let sp = event.systemPrompt;
		if (!sp.includes(marker)) {
			sp += "\n\n" + rules;
		} else {
			sp = sp.replace(marker, rules + "\n\n" + marker);
		}

		return {
			systemPrompt: sp,
		};
	});
}
