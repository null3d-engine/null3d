// The complete sketches that the agent skills show: each TypeScript code block in a skill's
// Markdown whose code exports `defineSketch(...)`. The tests type check them against the engine
// and draw them in hold mode, so every call that such a sketch shows exists and runs. A sketch
// under a heading that names a later version, such as (0.2), (after 1.0) or (later in 0.1), uses
// parts that are not built yet. The tests leave it out until its heading loses the version.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { walkFiles } from '../../tools/lib/files.ts';

/** A complete sketch in a skill's Markdown. */
export interface SkillSketch {
	/** A unique name from the skill, the file and the heading: lowercase words joined by dashes. */
	name: string;
	/** The Markdown file, from the repository root. */
	file: string;
	/** The line of the file where the code starts. */
	line: number;
	/** The heading that the code block sits under. */
	heading: string;
	code: string;
	/** The later version that the heading names, for a sketch the tests leave out. */
	later?: string;
	/** True when the sketch picks a camera, so its frame must show more than the background. */
	draws: boolean;
}

/** A group in parentheses that names a later version than the one being built. */
const LATER_VERSION = /\(([^)]*\b(?:later in 0\.1|after 1\.0|0\.[2-9]|[1-9]\.\d+)\b[^)]*)\)/i;

/** A fence that opens a TypeScript code block, and the fence that closes any code block. */
const TS_FENCE = /^```(?:ts|typescript)\s*$/;
const FENCE = /^```/;

const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

/** The complete sketches in one Markdown file's text. `file` names the file in each sketch. */
export function sketchesIn(file: string, text: string): SkillSketch[] {
	const sketches: SkillSketch[] = [];
	const lines = text.split('\n');
	let heading = '';
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.startsWith('#')) {
			heading = line.replace(/^#+\s*/, '');
			continue;
		}
		if (!TS_FENCE.test(line)) {
			// Skips a code block in another language whole, so a # line inside it is no heading.
			if (FENCE.test(line)) while (i + 1 < lines.length && !FENCE.test(lines[++i] ?? ''));
			continue;
		}
		const start = i + 1;
		while (i + 1 < lines.length && !FENCE.test(lines[++i] ?? ''));
		const code = lines.slice(start, i).join('\n');
		if (!/export default defineSketch\(/.test(code)) continue;
		const later = heading.match(LATER_VERSION)?.[1];
		sketches.push({
			name: '',
			file,
			line: start + 1,
			heading,
			code: `${code}\n`,
			...(later !== undefined && { later }),
			draws: /\bsetActiveCamera\(/.test(code),
		});
	}
	return sketches;
}

/** Every complete sketch in the skills under `root`, each with a unique name. */
export function skillSketches(root: string): SkillSketch[] {
	const sketches = walkFiles(root, 'skills', (path) => path.endsWith('.md')).flatMap((file) =>
		sketchesIn(file, readFileSync(join(root, file), 'utf8')),
	);
	const counts = new Map<string, number>();
	for (const sketch of sketches) {
		const base = slug(
			`${sketch.file.replace(/^skills\//, '').replace(/\.md$/, '')} ${sketch.heading}`,
		);
		const count = (counts.get(base) ?? 0) + 1;
		counts.set(base, count);
		sketch.name = count === 1 ? base : `${base}-${count}`;
	}
	return sketches;
}

/** The sketches that the tests run: those whose headings name no later version. */
export const runnableSketches = (root: string): SkillSketch[] =>
	skillSketches(root).filter((sketch) => sketch.later === undefined);

/**
 * Writes each sketch into `dir` as `<name>.ts`, with a tsconfig.json that type checks them all as
 * a project's sketches, and returns the sketches' paths from `root`. Each file is written in full
 * and then renamed, so a server that reads it at the same time never sees half of it.
 */
export function writeSketches(
	root: string,
	dir: string,
	sketches: readonly SkillSketch[],
): Map<string, string> {
	mkdirSync(dir, { recursive: true });
	const base = relative(dir, join(root, 'tsconfig.web.base.json'));
	const files: [string, string][] = [
		...sketches.map((sketch) => [`${sketch.name}.ts`, sketch.code] as [string, string]),
		[
			'tsconfig.json',
			JSON.stringify({
				extends: base,
				// Projects rarely turn on unchecked index access, so the skills' loops over typed
				// arrays are checked as a project checks them.
				compilerOptions: { types: ['@webgpu/types'], noUncheckedIndexedAccess: false },
				include: ['*.ts'],
			}),
		],
	];
	for (const [name, content] of files) {
		const path = join(dir, name);
		// Test workers write the same files at once, so each writes a file of its own and renames it.
		const temporary = `${path}.${process.pid}.tmp`;
		writeFileSync(temporary, content);
		renameSync(temporary, path);
	}
	return new Map(
		sketches.map((sketch) => [sketch.name, relative(root, join(dir, `${sketch.name}.ts`))]),
	);
}

/** The folder, under the tests' ignored output, where the tests write the skills' sketches. */
export const SKETCH_DIR = 'tests/test-results/skill-sketches';
