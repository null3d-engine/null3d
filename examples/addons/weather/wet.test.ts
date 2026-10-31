// The wet surface block is one piece of WGSL that every reader copies, because the shader build
// resolves only the engine's library and a shader cannot import another shader. This test compares
// each copy with the add-on's canonical block and fails when one of them is edited alone, as the
// wind add-on's test does for its field block.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/** The text between two markers of a file, trimmed. */
function marked(file: URL, name: string): string {
	const text = readFileSync(file, 'utf8');
	const start = text.indexOf(`// <${name}>`);
	const end = text.indexOf(`// </${name}>`);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return text.slice(start + `// <${name}>`.length, end).trim();
}

/** The canonical block, which every other copy must equal. */
const canonical = new URL('./wet.wgsl', import.meta.url);

/** The readers that hold a copy of the block. */
const readers: readonly (readonly [string, URL])[] = [
	['the Skyway ground', new URL('../../showcase/skyway/city.ts', import.meta.url)],
	['the Night town street', new URL('../../compare/night-town/shaders.ts', import.meta.url)],
	[
		'the weather cost page',
		new URL('../../../tests/pages/sketches/weather-cost-sketch.ts', import.meta.url),
	],
];

describe('the wet surface block', () => {
	test('every reader holds a copy byte-equal to the canonical block', () => {
		const block = marked(canonical, 'wet-surface');
		// A block that lost its code would match an empty copy, so the canonical one must carry the
		// functions that the readers call.
		expect(block).toContain('fn wet_noise_depth(');
		expect(block).toContain('fn wet_surface(');
		for (const [name, file] of readers)
			expect({ name, copy: marked(file, 'wet-surface') }).toEqual({ name, copy: block });
	});
});
