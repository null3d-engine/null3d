// The wood's shader is the plant shader without its casters' coverage function. Wood covers its
// whole surface, so its alpha is always 1 and it draws without the mask: a masked build discards
// fragments, which costs the GPU's early depth test, and the engine takes `fn coverage` only under a
// mask. The engine's WGSL compiler takes no includes, so render/wood.wgsl is written from
// render/plant.wgsl, and this test holds the two together. After a change to plant.wgsl, write it
// again with: NULL3D_WRITE_WOOD_SHADER=1 bun test packages/vegetation/src/render/wood-shader.test.ts
import { describe, expect, it } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WRITE = process.env.NULL3D_WRITE_WOOD_SHADER !== undefined;
const PLANT = join(import.meta.dir, 'plant.wgsl');
const WOOD = join(import.meta.dir, 'wood.wgsl');

const HEADER = `// The plant shader for the wood role, without the casters' coverage function: written from
// plant.wgsl by render/wood-shader.test.ts. Edit plant.wgsl, then write this file again.
`;

/** The coverage function with its doc comment, through its closing brace at the start of a line. */
const COVERAGE = /(?:\/\/\/[^\n]*\n)*fn coverage\(input: SurfaceInput\) -> f32 \{[\s\S]*?\n\}\n\n/;

function woodShader(plant: string): string {
	const cut = plant.replace(COVERAGE, '');
	if (cut === plant) throw new Error('plant.wgsl has no coverage function to cut');
	return HEADER + cut;
}

describe('the wood shader', () => {
	const plant = readFileSync(PLANT, 'utf8');
	const expected = woodShader(plant);
	if (WRITE) writeFileSync(WOOD, expected);

	it('is the plant shader without its coverage function', () => {
		expect(readFileSync(WOOD, 'utf8')).toBe(expected);
	});

	it('keeps every hook but the coverage', () => {
		const wood = readFileSync(WOOD, 'utf8');
		expect(wood).not.toContain('fn coverage(');
		for (const hook of ['fn surface(', 'fn vertexOffset(']) expect(wood).toContain(hook);
		expect(plant).toContain('fn coverage(');
	});

	it('keeps the wood whole in the plant shader: its alpha is always 1', () => {
		const coverage = plant.slice(plant.indexOf('fn coverage('));
		const casts = coverage.slice(0, coverage.indexOf('\n}\n'));
		expect(casts).toMatch(/var alpha = 1\.0;/);
		expect(casts).not.toContain('MODE_WOOD');
		const surface = plant.slice(plant.indexOf('fn surface('));
		const wood = surface.slice(
			surface.indexOf('if (mode == MODE_WOOD) {'),
			surface.indexOf('} else if (mode == MODE_CARDS)'),
		);
		expect(wood.length).toBeGreaterThan(0);
		expect(wood).not.toMatch(/\balpha\s*=/);
	});
});
