import { afterAll, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	analyseMerge,
	conflictsIn,
	KNOWN_MERGES,
	mergeProblem,
	mergesToCheck,
	NEW_WORD_ALLOWANCE,
} from './check-merges';

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const BASE = [
	'export function area(width: number, height: number): number {',
	'	return width * height;',
	'}',
	'',
	'export const LIMIT = 16;',
	'',
	'export function label(name: string): string {',
	'	return "light " + name;',
	'}',
	'',
].join('\n');

const SHADER = ['fn shade(color: vec3f) -> vec3f {', '    return color;', '}', ''].join('\n');

/**
 * A repository whose two branches change one line each way, so merging them conflicts there. The
 * merge commit holds `resolve`'s files; it returns the merge's hash and the repository.
 */
function mergeWith(files: Record<string, string>, message = 'Merge branch side'): [string, string] {
	const dir = mkdtempSync(join(tmpdir(), 'null3d-merges-'));
	dirs.push(dir);
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('config', 'commit.gpgsign', 'false');
	const write = (path: string, text: string) => writeFileSync(join(dir, path), text);
	write('scene.ts', BASE);
	write('lit.wgsl', SHADER);
	git('add', '.');
	git('commit', '-qm', 'base');
	git('checkout', '-qb', 'side');
	write('scene.ts', BASE.replace('LIMIT = 16', 'LIMIT = 32'));
	git('commit', '-qam', 'side');
	git('checkout', '-q', 'main');
	write('scene.ts', BASE.replace('LIMIT = 16', 'LIMIT = 24; // the default'));
	git('commit', '-qam', 'main');
	spawnSync('git', ['merge', '--no-commit', 'side'], { cwd: dir });
	for (const [path, text] of Object.entries(files)) write(path, text);
	git('add', '.');
	git('commit', '-qm', message);
	return [git('rev-parse', 'HEAD').trim(), dir];
}

const resolved = BASE.replace('LIMIT = 16', 'LIMIT = 32; // the default');

describe('KNOWN_MERGES', () => {
	it('names the nine merges that the owner let stand, by full ids', () => {
		// A full id names one commit, so a merge with new work under another id is still refused.
		expect(KNOWN_MERGES.size).toBe(9);
		for (const sha of KNOWN_MERGES) expect(sha).toMatch(/^[0-9a-f]{40}$/);
	});

	it('leaves out only the named merges, and every other merge, by full id', () => {
		const known = [...KNOWN_MERGES][0] as string;
		const other = 'a'.repeat(40);
		expect(mergesToCheck([known, other, ''])).toEqual([other]);
		expect(mergesToCheck([known.slice(0, 9)])).toEqual([known.slice(0, 9)]);
	});
});

describe('conflictsIn', () => {
	it('finds each conflict and the lines of its sides', () => {
		const text = 'a\n<<<<<<< ours\nb\n=======\nc\n>>>>>>> theirs\nd\n';
		expect(conflictsIn(text)).toEqual([{ start: 2, end: 6, sides: ['b', 'c'] }]);
	});
});

// The merges here are new, so each check passes an empty start to read merges of any age.
describe('analyseMerge', () => {
	// Each case builds a repository and merges in it, which starts many git processes. A loaded
	// machine needs longer than the default test limit.
	const gitCase = (name: string, fn: () => void) => it(name, fn, 30_000);

	gitCase('passes a merge that only resolves its conflict from the two sides', () => {
		const finding = analyseMerge(...mergeWith({ 'scene.ts': resolved }), '');
		expect(finding?.words).toBe(0);
		expect(finding && mergeProblem(finding)).toBeNull();
	});

	gitCase('passes a merge that moves lines or renumbers them', () => {
		const moved = resolved
			.replace('export const LIMIT = 32; // the default\n\n', '')
			.concat('export const LIMIT = 48; // the default\n');
		const finding = analyseMerge(...mergeWith({ 'scene.ts': moved }), '');
		expect(finding && mergeProblem(finding)).toBeNull();
	});

	gitCase('refuses a merge that writes a new function outside its conflict', () => {
		const feature = `${resolved}
export function volume(width: number, height: number, depth: number): number {
	// The box's volume, for the culling pass that sorts boxes by how much space they fill.
	const base = area(width, height);
	return base * depth;
}
`;
		const finding = analyseMerge(...mergeWith({ 'scene.ts': feature }), '');
		expect(finding?.words).toBeGreaterThan(NEW_WORD_ALLOWANCE);
		expect(finding?.files.get('scene.ts')?.[0]).toContain('function volume');
		expect(finding && mergeProblem(finding)).toContain('words of new work');
	});

	gitCase('refuses new shader code in a merge, however short', () => {
		const shading = SHADER.replace('return color;', 'return color * 0.5;\n    // dimmer');
		const finding = analyseMerge(...mergeWith({ 'scene.ts': resolved, 'lit.wgsl': shading }), '');
		expect(finding?.shaderLines).toBe(1);
		expect(finding && mergeProblem(finding)).toContain('line(s) of new shader code');
	});

	gitCase('passes new work that a Merge-Edit trailer explains', () => {
		const feature = `${resolved}\nexport function volume(width: number, height: number, depth: number): number {\n\treturn area(width, height) * depth * VOLUME_SCALE_FOR_THE_CULLING_PASS_OF_BOXES;\n}\n`;
		const message =
			'Merge branch side\n\nMerge-Edit: scene.ts volume() follows the area() rename that main made';
		const finding = analyseMerge(...mergeWith({ 'scene.ts': feature }, message), '');
		expect(finding?.reason).toContain('rename');
		expect(finding && mergeProblem(finding)).toBeNull();
	});

	gitCase('does not accept a bare Merge-Edit trailer', () => {
		const feature = `${resolved}\nexport function volume(width: number, height: number, depth: number): number {\n\t// The box's volume, for the culling pass that sorts boxes by how much space they fill.\n\treturn area(width, height) * depth;\n}\n`;
		const finding = analyseMerge(
			...mergeWith({ 'scene.ts': feature }, 'Merge branch side\n\nMerge-Edit: yes'),
			'',
		);
		expect(finding?.reason).toBeNull();
		expect(finding && mergeProblem(finding)).not.toBeNull();
	});

	gitCase('skips a merge committed before the rule', () => {
		expect(analyseMerge(...mergeWith({ 'scene.ts': resolved }), '2999-01-01T00:00:00Z')).toBeNull();
	});
});
