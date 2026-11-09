// The rule the core maths states: every value that reaches a plant's bytes comes from the core
// maths, so a plant is the same on every script engine. A scan of the package's shipped source finds
// any browser function whose rounding the standard leaves to each engine, and any power other than
// a square, outside the files whose numbers never reach a plant's bytes.
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The package's source folder. */
const SOURCE = join(import.meta.dir, '..');

/** Files that may use the browser's maths, each with the reason its numbers never reach a plant. */
const OUTSIDE: Readonly<Record<string, string>> = {
	'render/hand-over.ts': 'the distances where drawn levels hand over, worked out in the page',
	'render/material.ts': 'the culling spheres of drawn copies, worked out in the page',
	'render/stand-in.ts': "each drawn stand-in's turn, set in the page",
	'render/static-shoots.ts': "the camera's view scale and each drawn copy's turn",
	'grass/grass.ts': 'grass made in the page, on the GPU where WebGPU runs',
	'floating-leaves/floating-leaves.ts': "the wind add-on's falling leaves, made in the page",
	'wood/wood-measure.ts': "measures of the wood mesher's output for its tests",
	'wood/wood-test-tree.ts': "a hand-built tree for the wood mesher's tests",
};

/**
 * A browser function whose result the standard does not round exactly, or a power other than a
 * square: every engine computes a square as one product, but no other power.
 */
const BROWSER =
	/\bMath\.(acosh?|asinh?|atan2|atanh?|cbrt|cosh?|exp|expm1|hypot|log|log1p|log2|log10|pow|sinh?|tanh?)\s*\(|\*\*(?!\s*2(?![\w.]))/g;

/** The package's shipped TypeScript files: every one but the tests and their fixtures. */
function shipped(folder: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(folder)) {
		const path = join(folder, name);
		if (statSync(path).isDirectory()) out.push(...shipped(path));
		else if (name.endsWith('.ts') && !/\.test\.ts$|\.fixture\.ts$|test-support/.test(name))
			out.push(path);
	}
	return out.sort();
}

/** The source with its comments and string contents blanked, keeping every line where it stands. */
function code(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const two = text.slice(i, i + 2);
		const quote = text[i] as string;
		let end: number;
		if (two === '/*') {
			const close = text.indexOf('*/', i + 2);
			end = close < 0 ? text.length : close + 2;
		} else if (two === '//') {
			const close = text.indexOf('\n', i);
			end = close < 0 ? text.length : close;
		} else if (quote === "'" || quote === '"' || quote === '`') {
			end = i + 1;
			while (end < text.length && text[end] !== quote) end += text[end] === '\\' ? 2 : 1;
			end = Math.min(text.length, end + 1);
		} else {
			out += quote;
			i++;
			continue;
		}
		out += text.slice(i, end).replace(/[^\n]/g, ' ');
		i = end;
	}
	return out;
}

/** The lines of `text` that use the browser's maths, counted from 1. */
function browserLines(text: string): number[] {
	const blank = code(text);
	return [...blank.matchAll(BROWSER)].map((m) => blank.slice(0, m.index).split('\n').length);
}

describe('the core maths rule', () => {
	it("keeps the browser's own maths out of every file whose numbers reach a plant", () => {
		const found: string[] = [];
		for (const file of shipped(SOURCE)) {
			const name = relative(SOURCE, file);
			if (name in OUTSIDE) continue;
			for (const line of browserLines(readFileSync(file, 'utf8'))) found.push(`${name}:${line}`);
		}
		expect(found).toEqual([]);
	});

	it('finds a browser function and an odd power, and passes a square', () => {
		expect(browserLines('const a = 1;\nconst b = Math.cos(t);')).toEqual([2]);
		expect(browserLines('const c = x ** 1.5;')).toEqual([1]);
		// A 2 that starts a longer number is not a square.
		expect(browserLines('const g = x ** 2.5 + y ** 2e3 + z ** 25;')).toEqual([1, 1, 1]);
		expect(browserLines('const d = (a - b) ** 2 + Math.sqrt(y);')).toEqual([]);
		// A square whose exponent wraps onto the next line is still a square.
		expect(browserLines('const e = (a - b) **\n\t2;')).toEqual([]);
		// Comments and strings do not count.
		expect(browserLines("/** Math.cos(t) */ const f = 'x ** 3'; // y ** 3")).toEqual([]);
	});

	it('names only files that exist', () => {
		for (const name of Object.keys(OUTSIDE))
			expect(statSync(join(SOURCE, name)).isFile()).toBe(true);
	});
});
