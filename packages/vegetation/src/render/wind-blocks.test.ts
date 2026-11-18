// The add-on's readers of the wind field hold one copy of its blocks. A shader cannot import another
// package's shader, so each reader copies the field's steady settings and its sampling function.
// The plant shader, the floating leaves and two test pages read the field: the cost page carries
// both blocks, and the gust page carries the steady block twice and keeps only the reading function
// of the other, so it is held to the steady block alone. Each is held to the wind add-on's
// canonical file, which the wind add-on's own test holds the grass's copy to as well.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/** A file's text, by its address from this folder. */
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

/** The text of one marked block, from its opening mark to its closing one. */
function block(source: string, name: string): string {
	const from = `// <${name}>`;
	const to = `// </${name}>`;
	return source.slice(source.indexOf(from), source.indexOf(to));
}

const FIELD = '../../../wind/shaders/field.wgsl';
const COST_PAGE = '../../../../tests/pages/sketches/wind-reader-cost-sketch.ts';
const GUST_PAGE = '../../../../tests/pages/sketches/gust-crossing-sketch.ts';

describe('the wind blocks of the add-on', () => {
	test("read the wind field with the wind add-on's own copy in every reader", () => {
		for (const name of ['wind-steady', 'wind-sample']) {
			const canonical = block(read(FIELD), name);
			expect(canonical.length).toBeGreaterThan(0);
			for (const file of [
				'./plant.wgsl',
				'../floating-leaves/floating-leaves.wgsl',
				'../floating-leaves/floating-leaves-state.wgsl',
				'../floating-leaves/floating-leaves-state.fallback.wgsl',
				COST_PAGE,
				...(name === 'wind-steady' ? [GUST_PAGE] : []),
			])
				expect(block(read(file), name)).toBe(canonical);
		}
		// The gust page draws the steady block twice, once for each path's form.
		const gust = read(GUST_PAGE);
		const steady = block(read(FIELD), 'wind-steady');
		const copies = gust.split('// <wind-steady>').length - 1;
		expect(copies).toBe(2);
		for (const piece of gust.split('// <wind-steady>').slice(1))
			expect(`// <wind-steady>${piece.slice(0, steady.length - '// <wind-steady>'.length)}`).toBe(
				steady,
			);
	});
});
