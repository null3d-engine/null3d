import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

/**
 * The hash that takes the fraction of a large sine, in a shader or on the CPU. Each GPU works out
 * the sine its own way, so the same code draws other pixels on other machines.
 */
const SINE_HASH = [/fract\s*\(\s*sin\s*\(/, /43758\.5453/];

/**
 * A helper that makes randomness, by the name it declares. Its numbers must come from integer
 * arithmetic, which every GPU works out alike, whatever it fuses into one instruction.
 */
const HASHING_HELPER = /hash|random/i;

/**
 * A `fract` of a product that a fractional literal scales, in one statement: a float hash of the
 * product's inputs. The sine of a large number is the same kind of hash, and a GPU rounds this one
 * as it rounds that, so the same inputs draw other pixels on another machine.
 */
const FLOAT_HASH = /fract\([^;]*\*[^;]*\d\.\d[^;]*\)/;

/** The files of code that git keeps: TypeScript, JavaScript, WGSL, GLSL and Rust. */
function codeFiles(): string[] {
	const listed = Bun.spawnSync(['git', 'ls-files', '*.ts', '*.js', '*.wgsl', '*.glsl', '*.rs'], {
		cwd: ROOT,
	});
	return listed.stdout.toString().split('\n').filter(Boolean);
}

/** Each `fn` of `source` whose name says it hashes or randomises, with the name and body. */
function hashingHelpers(source: string): { name: string; body: string }[] {
	const helpers: { name: string; body: string }[] = [];
	for (const declared of source.matchAll(/\bfn\s+(\w+)\s*\(/g)) {
		const name = declared[1] ?? '';
		if (!HASHING_HELPER.test(name)) continue;
		const open = source.indexOf('{', declared.index);
		let depth = 0;
		let end = open;
		for (; end < source.length; end++) {
			if (source[end] === '{') depth++;
			else if (source[end] === '}' && --depth === 0) break;
		}
		helpers.push({ name, body: source.slice(open, end + 1) });
	}
	return helpers;
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

	it('comes from integer hashes, never from a float hash in a helper that hashes or randomises', () => {
		const found: string[] = [];
		let helpers = 0;
		for (const file of codeFiles()) {
			const source = readFileSync(join(ROOT, file), 'utf8');
			for (const helper of hashingHelpers(source)) {
				helpers++;
				if (FLOAT_HASH.test(helper.body)) found.push(`${file}: ${helper.name}`);
			}
		}
		// The guard has something to judge: null3d::noise's random helpers, the alpha hash, the
		// cells of the sky's stars and any other helper whose name says it randomises something.
		expect(helpers).toBeGreaterThan(5);
		// Hash a whole number with null3d::noise's pcg, lattice, pcg3d or to_unit, and take the
		// fraction of that hash where a value from 0 to 1 is wanted.
		expect(found).toEqual([]);
	});
});
