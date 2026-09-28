// Commit-msg guard: a commit that changes the public API, the shader library, the three.js mapping
// or the skills themselves must carry a `Skills-Checked:` trailer, the record that the skill text
// showing that API was re-read (AGENTS.md, "Commit gates"). The skills check covers the mechanical
// half: that every docs page a skill names exists and that the generated copies match.
import { type AckRule, bearingFiles, checkAck, runAckHook, summarizeBearing } from './commit-ack';

/** Paths whose changes can make a skill wrong: the API it teaches, and the skills' own files. */
export const SKILL_BEARING_PATTERNS: RegExp[] = [
	/^packages\/[^/]+\/src\//,
	/^crates\/null3d-shaders\/(src|wgsl)\//,
	/^skills\//,
	/^docs\/data\/threejs-mapping\.json$/,
];

export const SKILLS_ACK_RULE: AckRule = {
	trailer: 'Skills-Checked',
	patterns: SKILL_BEARING_PATTERNS,
	missingMessage: (bearing) =>
		`This commit changes an API, the mapping or a skill (${summarizeBearing(bearing)}) but has ` +
		'no Skills-Checked: trailer. The pass covers every skill file that shows the changed API.',
	emptyMessage: (value) =>
		`Skills-Checked value "${value}" acknowledges nothing: name the skill files you updated or re-read, or say why none apply.`,
	guidance: [
		'Every commit that can make a skill wrong records the skills pass (AGENTS.md, "Commit gates").',
		'Re-read the skill files that show the API you changed, keep each fact in one place (skills',
		'link to docs pages by ID), and check that they speak only to developers who use the engine,',
		'with no milestones, internal plans or build history. Then add a trailer, for example:\n',
		'  Skills-Checked: updated references/api-quickref.md for the new markDirty signature',
		'  Skills-Checked: re-read both skills; no skill shows the changed function',
	],
};

export function skillBearingFiles(changedFiles: string[]): string[] {
	return bearingFiles(changedFiles, SKILL_BEARING_PATTERNS);
}

export function checkCommitMessage(
	rawMessage: string,
	changedFiles: string[],
): { ok: boolean; error?: string } {
	return checkAck(rawMessage, changedFiles, SKILLS_ACK_RULE);
}

if (import.meta.main) runAckHook(SKILLS_ACK_RULE, 'check-skills-ack.ts');
