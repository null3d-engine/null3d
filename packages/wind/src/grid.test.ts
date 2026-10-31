import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CURL_STEP, GROUND_HEIGHT, PUSH_LIFE } from './analytic';
import { CYCLE_STEPS, PRESSURE_STEPS } from './wind';

/** The text between two markers of a file, trimmed. */
function marked(file: URL, name: string): string {
	const text = readFileSync(file, 'utf8');
	const start = text.indexOf(`// <${name}>`);
	const end = text.indexOf(`// </${name}>`);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return text.slice(start + `// <${name}>`.length, end).trim();
}

/** The grid's WebGL2 form. */
const fallbackFile = new URL('./grid.fallback.wgsl', import.meta.url);
/** The grid's compute form. */
const gridFile = new URL('./grid.wgsl', import.meta.url);
/** The file a reader copies the sampling function from. */
const fieldFile = new URL('../shaders/field.wgsl', import.meta.url);
/** The add-on's own page, whose card material is the first reader. */
const pageFile = new URL('../page/sketch.ts', import.meta.url);
/** The page that shows a person what to copy into their own shader. */
const docsFile = new URL('../../../docs/api/wind.md', import.meta.url);
/** The vegetation add-on's leaf and bark material, which reads the field in its vertex offset. */
const plantFile = new URL('../../vegetation/src/plant.wgsl', import.meta.url);
/** The add-on's morphing leaf cards, which read the same field. */
const cardsFile = new URL('../../vegetation/src/plant-cards.wgsl', import.meta.url);

describe('the shaders of the grid', () => {
	test('the compute form, the WebGL2 form and the sampling file hold one steady field', () => {
		// The shader build resolves only the engine's library, so a shader cannot import another
		// shader of the add-on. The forms therefore carry copies, and this keeps them equal.
		const canonical = marked(fieldFile, 'wind-steady');
		expect(marked(gridFile, 'wind-steady')).toBe(canonical);
		expect(marked(fallbackFile, 'wind-steady')).toBe(canonical);
	});

	test('the two grid forms hold one set of slots, a push or a gust each', () => {
		expect(marked(fallbackFile, 'wind-events')).toBe(marked(gridFile, 'wind-events'));
	});

	test('the two grid forms hold one solver', () => {
		// The solver's maths is shared, and each form gives it its own way of reading the state.
		expect(marked(fallbackFile, 'wind-solver')).toBe(marked(gridFile, 'wind-solver'));
	});

	test('the shaders’ constants are the TypeScript form’s', () => {
		const steady = marked(gridFile, 'wind-steady');
		const constant = (text: string, name: string): number => {
			const match = new RegExp(`const ${name}: (?:f32|i32) = ([0-9.]+);`).exec(text);
			expect(match).not.toBeNull();
			return Number(match?.[1]);
		};
		expect(constant(steady, 'WIND_GROUND_HEIGHT')).toBe(GROUND_HEIGHT);
		expect(constant(steady, 'WIND_CURL_STEP')).toBe(CURL_STEP);
		expect(constant(marked(gridFile, 'wind-events'), 'WIND_PUSH_LIFE')).toBe(PUSH_LIFE);
		// The step count of a cycle is the same in the shader and in the add-on that asks for it.
		const solver = marked(gridFile, 'wind-solver');
		expect(constant(solver, 'WIND_PRESSURE_STEPS')).toBe(PRESSURE_STEPS);
		// The cycle adds the advection and the projection to the pressure's iterations.
		expect(solver).toContain('const WIND_CYCLE: i32 = WIND_PRESSURE_STEPS + 2;');
		expect(CYCLE_STEPS).toBe(PRESSURE_STEPS + 2);
	});

	test('both forms write the wind the same way', () => {
		// The texture holds the wind across the ground and, in its fourth channel, the local speed,
		// which a leaf reads to flutter harder in a gust.
		const compute = readFileSync(gridFile, 'utf8');
		const fallback = readFileSync(fallbackFile, 'utf8');
		// The texture holds the air across the ground, the pressure and the stage, in that order.
		for (const form of [compute, fallback])
			expect(form).toContain('vec4f(next.v.x, next.v.y, next.pressure, f32(next.stage))');
		// The box arrives in the eighth value vector, and the settings in the three before the slots.
		expect(compute).toContain('block.u7');
		expect(fallback).toContain('uniforms.u7');
	});
});

describe('the sampling function', () => {
	test('the page reads the field with the add-on’s own copies of it', () => {
		// The shader build resolves only the engine's library, so a reader holds copies. The page's
		// card material is the first reader, and this fails when either copy is edited alone.
		const steady = marked(fieldFile, 'wind-steady');
		const sample = marked(fieldFile, 'wind-sample');
		expect(marked(pageFile, 'wind-steady')).toBe(steady);
		expect(marked(pageFile, 'wind-sample')).toBe(sample);
		// The docs page holds the copy that a person pastes, so it is kept equal too.
		expect(marked(docsFile, 'wind-steady')).toBe(steady);
		expect(marked(docsFile, 'wind-sample')).toBe(sample);
		// The vegetation add-on reads this field for its plants, so its two materials carry the
		// same blocks.
		for (const file of [plantFile, cardsFile]) {
			expect(marked(file, 'wind-steady')).toBe(steady);
			expect(marked(file, 'wind-sample')).toBe(sample);
		}
	});

	test('the copy reads the texture inside the box and the steady field outside it', () => {
		const canonical = marked(fieldFile, 'wind-sample');
		// A reader declares the texture and the sampler beside it.
		expect(readFileSync(fieldFile, 'utf8')).toContain('var wind: texture_2d_array<f32>;');
		expect(canonical).toContain('textureSampleLevel(wind, windSampler');
		// The grid's state gives the air back: the air across the ground, and its speed.
		expect(canonical).toContain('return vec4f(state.r, 0.0, state.g, length(state.rg));');
		// A place outside the box, or a device that keeps no grid, reads the analytic far field.
		expect(canonical).toContain('if (size > 0.0)');
		expect(canonical).toContain('wind_steady(air, vec3f(world.x, WIND_FULL_HEIGHT, world.z))');
	});
});
