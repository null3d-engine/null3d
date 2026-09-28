// Checks and syncs the agent skills. skills/<name>/ is the source; .claude/skills/<name>/ is a
// generated copy without evals/, because Claude Code loads project skills only from .claude/skills.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DOC_AREAS, MAPPING_SOURCE, pagePath } from './docs';
import { mentionsBuildProcess, mentionsPrivatePlan } from './docs-style';
import { readIfExists, walkFiles } from './files';
import { parseFrontMatter } from './frontmatter';

export const SKILLS_DIR = 'skills';
export const SKILL_COPY_DIR = '.claude/skills';

const ALLOWED_KEYS = new Set([
	'name',
	'description',
	'license',
	'allowed-tools',
	'metadata',
	'compatibility',
]);
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;
const MAX_BODY_LINES = 500;
/** About 5,000 tokens: the budget for a skill body. */
const BODY_WORD_BUDGET = 3800;
const MAPPING_COPY = 'skills/sokko3d-port-threejs/references/threejs-mapping.json';

export function skillNames(root: string): string[] {
	const dir = join(root, SKILLS_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((n) => statSync(join(dir, n)).isDirectory())
		.sort();
}

const isEval = (name: string, path: string) => path.startsWith(`${SKILLS_DIR}/${name}/evals/`);

/** The expected .claude/skills copy: every skill file except evals/, keyed by its copy path. */
export function expectedSkillCopies(root: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const name of skillNames(root)) {
		for (const path of walkFiles(root, `${SKILLS_DIR}/${name}`, (p) => !isEval(name, p))) {
			out.set(
				`${SKILL_COPY_DIR}/${path.slice(SKILLS_DIR.length + 1)}`,
				readFileSync(join(root, path), 'utf8'),
			);
		}
	}
	return out;
}

/** Differences between .claude/skills and its expected content: missing, changed and extra files. */
export function skillCopyProblems(root: string): string[] {
	const expected = expectedSkillCopies(root);
	const problems: string[] = [];
	for (const [path, content] of expected) {
		const actual = readIfExists(root, path);
		if (actual === null) problems.push(`${path} is missing: run bun run skills`);
		else if (actual !== content) problems.push(`${path} is out of date: run bun run skills`);
	}
	for (const path of walkFiles(root, SKILL_COPY_DIR)) {
		if (!expected.has(path)) problems.push(`${path} has no source in skills/: run bun run skills`);
	}
	return problems;
}

/** Rewrites .claude/skills to match skills/. Returns the paths written or removed. */
export function syncSkills(root: string): string[] {
	const expected = expectedSkillCopies(root);
	const changed: string[] = [];
	for (const path of walkFiles(root, SKILL_COPY_DIR)) {
		if (!expected.has(path)) {
			rmSync(join(root, path));
			changed.push(path);
		}
	}
	for (const [path, content] of expected) {
		if (readIfExists(root, path) === content) continue;
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
		changed.push(path);
	}
	return changed;
}

/** Doc IDs a text names in backticks, such as `concepts/instances`, limited to real docs areas. */
export function docIdsIn(text: string): string[] {
	const ids: string[] = [];
	for (const m of text.matchAll(/`([a-z-]+\/[a-z0-9-]+)`/g)) {
		const id = m[1] ?? '';
		if (DOC_AREAS.has(id.split('/')[0] ?? '')) ids.push(id);
	}
	return ids;
}

/** Problems with one skill's SKILL.md and its references, scripts and evals. */
function checkSkill(root: string, name: string, docRefs: Map<string, Set<string>>): string[] {
	const problems: string[] = [];
	const dir = `${SKILLS_DIR}/${name}`;
	const text = readIfExists(root, `${dir}/SKILL.md`);
	if (text === null) return [`${name}: SKILL.md is missing`];

	let data: Record<string, unknown>;
	let body: string;
	try {
		const fm = parseFrontMatter(text);
		if (!fm) return [`${name}: SKILL.md has no front matter`];
		data = fm.data;
		body = fm.body;
	} catch (e) {
		return [`${name}: SKILL.md front matter is not valid YAML (${(e as Error).message})`];
	}

	for (const key of Object.keys(data)) {
		if (!ALLOWED_KEYS.has(key)) problems.push(`${name}: front matter key "${key}" is not allowed`);
	}
	const skillName = String(data.name ?? '');
	if (skillName !== name)
		problems.push(`${name}: front matter name "${skillName}" must equal the folder name`);
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName) || skillName.length > MAX_NAME) {
		problems.push(`${name}: name must be kebab-case, at most ${MAX_NAME} characters`);
	}
	const description = String(data.description ?? '');
	if (!description) problems.push(`${name}: description is missing`);
	if (description.length > MAX_DESCRIPTION) {
		problems.push(
			`${name}: description has ${description.length} characters (at most ${MAX_DESCRIPTION})`,
		);
	}
	if (/[<>]/.test(description))
		problems.push(`${name}: description must not contain angle brackets`);
	if (String(data.compatibility ?? '').length > MAX_COMPATIBILITY) {
		problems.push(`${name}: compatibility is longer than ${MAX_COMPATIBILITY} characters`);
	}
	const lines = body.split('\n').length;
	if (lines > MAX_BODY_LINES)
		problems.push(`${name}: SKILL.md body has ${lines} lines (keep it under ${MAX_BODY_LINES})`);
	const words = body.split(/\s+/).filter(Boolean).length;
	if (words > BODY_WORD_BUDGET) {
		problems.push(
			`${name}: SKILL.md body has ${words} words; the budget for a skill body is about 5,000 tokens`,
		);
	}

	for (const m of text.matchAll(/`((?:references|scripts)\/[\w./-]+)`/g)) {
		if (!existsSync(join(root, dir, m[1] ?? '')))
			problems.push(`${name}: SKILL.md names ${m[1]}, which does not exist`);
	}

	for (const path of walkFiles(
		root,
		dir,
		(p) => /\.(md|mjs|json|ts|js)$/.test(p) && !isEval(name, p),
	)) {
		const content = readFileSync(join(root, path), 'utf8');
		if (mentionsPrivatePlan(content))
			problems.push(`${path} points at the maintainers' private build plan`);
		if (mentionsBuildProcess(content))
			problems.push(
				`${path} names the maintainers' build process (milestones, checkpoints or task IDs)`,
			);
		const ids = docIdsIn(content);
		if (path.endsWith('threejs-mapping.json')) {
			for (const entry of (JSON.parse(content) as { entries?: { docs: string }[] }).entries ?? [])
				ids.push(entry.docs);
		}
		for (const id of ids) {
			if (!docRefs.has(id)) docRefs.set(id, new Set());
			docRefs.get(id)?.add(path);
		}
	}

	const evalsPath = `${dir}/evals/evals.json`;
	const evalsText = readIfExists(root, evalsPath);
	if (evalsText !== null) {
		const evals = JSON.parse(evalsText) as {
			skill_name?: string;
			evals: { id: number; files?: string[] }[];
		};
		if (evals.skill_name !== name)
			problems.push(`${name}: evals.json skill_name is "${evals.skill_name}"`);
		for (const e of evals.evals) {
			for (const f of e.files ?? []) {
				if (!existsSync(join(root, dir, f)))
					problems.push(`${name}: eval ${e.id} names missing file ${f}`);
			}
		}
	} else {
		problems.push(`${name}: evals/evals.json is missing`);
	}
	return problems;
}

export interface SkillsReport {
	skills: number;
	docPagesReferenced: number;
	problems: string[];
}

/** Every problem with the skills: their files, the docs pages they name, and the generated copies. */
export function checkSkills(root: string): SkillsReport {
	const names = skillNames(root);
	const docRefs = new Map<string, Set<string>>();
	const problems = names.flatMap((name) => checkSkill(root, name, docRefs));

	for (const [id, where] of docRefs) {
		if (!existsSync(join(root, pagePath(id)))) {
			problems.push(`docs page "${id}" does not exist (named in ${[...where].join(', ')})`);
		}
	}

	const source = readIfExists(root, MAPPING_SOURCE);
	const copy = readIfExists(root, MAPPING_COPY);
	if (
		source !== null &&
		copy !== null &&
		JSON.stringify(JSON.parse(source)) !== JSON.stringify(JSON.parse(copy))
	) {
		problems.push(`${MAPPING_COPY} differs from ${MAPPING_SOURCE}: run bun run docs`);
	}

	problems.push(...skillCopyProblems(root));
	return { skills: names.length, docPagesReferenced: docRefs.size, problems };
}
