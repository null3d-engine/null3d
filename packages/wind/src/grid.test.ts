import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CURL_STEP, GROUND_HEIGHT, GUST_SLOT, PUSH_LIFE, PUSH_SLOTS, RING_SLOTS } from './analytic';
import { CYCLE_STEPS, GROUND_PACK, PRESSURE_STEPS } from './wind';

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
/** The vegetation add-on's grass, which reads the field in its vertex offset. */
const grassFile = new URL('../../vegetation/src/grass/grass.wgsl', import.meta.url);
/** The engine's particle shader, which reads the field once for each particle. */
const particleFile = new URL('../../../crates/null3d-shaders/wgsl/particle.wgsl', import.meta.url);
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
		// The pressure count is the preset's, so it arrives with the frame in the ground setting's
		// whole part rather than as a constant, and the ground's share rides in its fraction.
		const solver = marked(gridFile, 'wind-solver');
		expect(solver).toContain('state: WindState, pressure: i32');
		expect(solver).toContain('state.stage <= pressure');
		expect(constant(solver, 'WIND_GROUND_PACK')).toBe(GROUND_PACK);
		for (const form of [gridFile, fallbackFile]) {
			const text = readFileSync(form, 'utf8');
			expect(text).toContain('let pressure = i32(floor(packed));');
			expect(text).toContain('air.ground = (packed - f32(pressure)) * WIND_GROUND_PACK;');
		}
		// The add-on packs the same two values, so its divisor must match the shaders'.
		expect(readFileSync(new URL('./wind.ts', import.meta.url), 'utf8')).toContain(
			'values[3] = solverPressureSteps() + air.ground / GROUND_PACK;',
		);
		// The default cycle still adds the advection and the projection to the pressure's iterations.
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

	test('the ring’s four slots are the three pushes and the gust, and no more', () => {
		// The add-on packs one slot into four value numbers, from 12, and the box starts where the
		// last slot ends. A push slot added without the shaders would run into the box's numbers,
		// and a gust moved to another index would read as a push there.
		expect(PUSH_SLOTS).toBe(3);
		expect(GUST_SLOT).toBe(PUSH_SLOTS);
		expect(RING_SLOTS).toBe(PUSH_SLOTS + 1);
		expect(12 + RING_SLOTS * 4).toBe(28);
		const events = marked(gridFile, 'wind-events');
		// The analytic field takes one argument for each push, then the gust.
		expect([...events.matchAll(/slot(\d+): vec4f/g)].map((match) => Number(match[1]))).toEqual([
			0, 1, 2,
		]);
		expect(events).toContain(`array<vec4f, ${PUSH_SLOTS}>(slot0, slot1, slot2)`);
		expect(events).toContain(`i < ${PUSH_SLOTS}u`);
		expect(events).toContain('wind_gust(air, gust, p)');
		// Each form reads the slots as one value vector for each, then the box from the next.
		for (const [name, file, source] of [
			['compute', gridFile, 'block'],
			['WebGL2', fallbackFile, 'uniforms'],
		] as const) {
			const text = readFileSync(file, 'utf8');
			const slots = new RegExp(`array<vec4f, (\\d+)>\\(${source}\\.[^)]*\\)`).exec(text);
			expect(slots?.[1], name).toBe(String(RING_SLOTS));
			expect(text, name).toContain(`${source}.u${3 + RING_SLOTS}`);
		}
	});

	test('the box’s edge takes the steady field that a reader works out past it', () => {
		// A reader past the box works out the steady field, which has no pushes and no sent gust.
		// The edge takes the same field, so the air is continuous across the edge rather than
		// stepping where a push reached it, and the projection leaves the edge where it is.
		for (const file of [gridFile, fallbackFile]) {
			const solver = marked(file, 'wind-solver');
			const advect = solver.slice(
				solver.indexOf('fn wind_advect'),
				solver.indexOf('fn wind_pressure'),
			);
			expect(advect).toContain('wind_steady(air, place)');
			expect(advect).not.toContain('v = pullTo.xz');
			const project = solver.slice(
				solver.indexOf('fn wind_project'),
				solver.indexOf('fn wind_step'),
			);
			expect(project).toContain('return WindState(state.v, state.pressure, 0);');
		}
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
		// The vegetation add-on reads this field for its grass, whose shader carries the same
		// blocks; the add-on's own test holds its other readers to the grass's copy.
		expect(marked(grassFile, 'wind-steady')).toBe(steady);
		expect(marked(grassFile, 'wind-sample')).toBe(sample);
		// The engine's particle shader reads the same field, once for each particle.
		expect(marked(particleFile, 'wind-steady')).toBe(steady);
		expect(marked(particleFile, 'wind-sample')).toBe(sample);
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
