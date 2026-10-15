import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

/**
 * The hash that takes the fraction of a large sine, in a shader or on the CPU. Each GPU works out
 * the sine its own way, so the same code draws other pixels on other machines.
 */
const SINE_HASH = [/fract\s*\(\s*sin\s*\(/, /43758\.5453/];

/** The files of code that git keeps: TypeScript, JavaScript, WGSL, GLSL and Rust. */
function codeFiles(): string[] {
	const listed = Bun.spawnSync(['git', 'ls-files', '*.ts', '*.js', '*.wgsl', '*.glsl', '*.rs'], {
		cwd: ROOT,
	});
	return listed.stdout.toString().split('\n').filter(Boolean);
}

describe('randomness in code', () => {
	it('comes from integer hashes, which every GPU works out alike, never from a sine hash', () => {
		const files = codeFiles();
		expect(files.length).toBeGreaterThan(100);
		const found = files.filter((file) => {
			const source = readFileSync(join(ROOT, file), 'utf8');
			return SINE_HASH.some((pattern) => pattern.test(source));
		});
		// Use the integer hashes of null3d::noise in WGSL, or a hash in integer math such as Night
		// town's town_hash where three.js draws the same look (.dev/image-tests.md).
		expect(found).toEqual([]);
	});
});
