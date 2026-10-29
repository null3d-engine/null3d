import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Camera, SketchContext } from '@null3d/engine';
import ts from 'typescript';
import { CYCLE_STEPS, createWind, holdsField, STEP_SECONDS } from './wind';

/** A camera that stands at the world's origin. */
const camera = {
	getPosition(out: number[]): void {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
	},
} as unknown as Camera;

/**
 * A sketch's context around a clock, with the render and texture calls stubbed out. `passes`
 * counts the passes that the add-on adds, so a test can tell a device that keeps no grid.
 */
function context(
	tier = 'webgpu',
	features: string[] = [],
	passes?: { count: number },
	steps?: number[],
	options?: unknown[],
	textures: unknown[] = [],
): SketchContext {
	const pass = { enabled: true, live: true };
	return {
		time: { now: 1 },
		engine: { capabilities: { tier, features } },
		render: {
			addPass: (given: unknown) => {
				if (passes) passes.count++;
				options?.push(given);
				return pass;
			},
			setPassUniforms: () => {},
			setPassSteps: (_pass: unknown, count: number) => {
				steps?.push(count);
			},
			removePass: () => {},
		},
		textures: {
			fromPass: () => ({ destroy: () => {} }),
			fromData: (given: unknown) => {
				textures.push(given);
				return { destroy: () => {} };
			},
		},
	} as unknown as SketchContext;
}

describe('the device that holds the field', () => {
	test('every WebGPU path holds it', () => {
		expect(holdsField({ tier: 'webgpu', features: [] })).toBe(true);
		expect(holdsField({ tier: 'webgpu-compat', features: ['shader-f16'] })).toBe(true);
	});

	test('a WebGL2 device needs a float target', () => {
		expect(holdsField({ tier: 'webgl2', features: ['EXT_color_buffer_float'] })).toBe(true);
		expect(holdsField({ tier: 'webgl2', features: ['EXT_color_buffer_half_float'] })).toBe(true);
		// Without either, the pass cannot keep an image, so the add-on costs no pass there.
		expect(holdsField({ tier: 'webgl2', features: ['OES_texture_float_linear'] })).toBe(false);
		expect(holdsField({ tier: 'webgl2', features: [] })).toBe(false);
	});
});

describe('the field that a reader samples', () => {
	test('a device without float targets keeps no grid and gives readers the steady field', () => {
		const passes = { count: 0 };
		const textures: unknown[] = [];
		const wind = createWind(
			context('webgl2', ['OES_texture_float_linear'], passes, [], [], textures),
			{
				camera,
				grid: 8,
			},
		);
		// No pass costs the device nothing, and a box of no width sends every sample to the steady
		// field that the sampling function works out, so a plant there still moves.
		expect(passes.count).toBe(0);
		expect(wind.field.size).toBe(0);
		// The stand-in texture is never read, since the box has no width, but it must still be a
		// texture the device takes: four bytes per texel for the default format.
		expect(textures[0]).toMatchObject({ width: 1, height: 1, depth: 1 });
		expect((textures[0] as { data: unknown }).data).toBeInstanceOf(Uint8Array);
		expect(wind.field.air.base).toEqual([4, 0, 0.65, 0]);
	});

	test('the pass keeps its state and runs the steps that the sketch time owes', () => {
		const steps: number[] = [];
		const options: unknown[] = [];
		const ctx = context('webgpu', [], undefined, steps, options);
		const wind = createWind(ctx, { camera, grid: 8 });
		// The field starts when the page makes it, so the first frame owes the cycles since then.
		expect(options[0]).toMatchObject({
			kind: 'compute',
			history: true,
			format: 'rgba16float',
			steps: CYCLE_STEPS,
		});
		expect(steps[0]).toBe(0);
		// A frame that adds a sixtieth of a second owes one cycle, and a frame that adds nothing
		// owes none.
		(ctx.time as { now: number }).now = 1 + STEP_SECONDS;
		wind.update();
		expect(steps[1]).toBe(CYCLE_STEPS);
		wind.update();
		expect(steps[2]).toBe(0);
	});

	test('a held page solves one cycle in its one drawn frame', () => {
		const steps: number[] = [];
		const ctx = context('webgpu', [], undefined, steps);
		// Hold mode runs the sketch's updates without drawing, from the first step to the hold time,
		// and draws once at the end. The pass advances only in that drawn frame, so the steps that
		// the last update sets are the ones that run.
		(ctx.time as { now: number }).now = 0;
		const wind = createWind(ctx, { camera, grid: 8 });
		for (let step = 0; step <= 60; step++) {
			(ctx.time as { now: number }).now = step * STEP_SECONDS;
			wind.update();
		}
		expect(steps.at(-1)).toBe(CYCLE_STEPS);
	});

	test('a box of no width keeps no grid either, so every sample is the steady field', () => {
		const passes = { count: 0 };
		const wind = createWind(context('webgpu', [], passes), { camera, box: 0, grid: 8 });
		expect(passes.count).toBe(0);
		expect(wind.field.size).toBe(0);
	});

	test('a device that holds the field takes its box, and each reader reads the settings', () => {
		const passes = { count: 0 };
		const wind = createWind(context('webgpu', [], passes), { camera, box: 96, grid: 8 });
		expect(passes.count).toBe(1);
		expect(wind.field.size).toBe(96);
		// The reading follows the steady wind, so a reader that works out the far field keeps step.
		wind.setBase(9, 0.5);
		expect(wind.field.air.base[0]).toBe(9);
		expect(wind.field.air.base[1]).toBe(0.5);
	});
});

describe('the calls that a frame makes', () => {
	test('reuse the objects that they are given', () => {
		const wind = createWind(context(), { camera, grid: 8 });
		const out: [number, number, number] = [0, 0, 0];
		const place: [number, number] = [1, 2];
		for (let i = 0; i < 100; i++) {
			wind.setBase(4, 0.3 + i * 0.001);
			wind.gust(place, 2);
			wind.push(place, 1);
			// The caller's own array comes back, so a sample makes no result object.
			expect(wind.sample(i * 0.5, 1, i * 0.25, out)).toBe(out);
			wind.update();
		}
		expect(out.some((value) => value !== 0)).toBe(true);
		// The box follows the camera: the stub stands at the origin, and the box is 128 wide.
		expect(wind.field.origin).toEqual([-64, -64]);
		// The field itself reads the noise through a hash that makes no tuple and no closure, so a
		// sample allocates nothing. The bytes per frame are the allocation gate's measure, which
		// D-265 names as owed.
	});

	test('a frozen field gives the same air at two times, and a live one does not', () => {
		const frozen = context();
		const still = createWind(frozen, {
			camera,
			grid: 8,
			air: { gustStrength: 0, swirl: 0 },
		});
		const first: [number, number, number] = [0, 0, 0];
		const later: [number, number, number] = [0, 0, 0];
		still.sample(3, 4, -2, first);
		(frozen.time as { now: number }).now = 2;
		still.sample(3, 4, -2, later);
		expect(later).toEqual(first);

		const live = context();
		const blowing = createWind(live, { camera, grid: 8 });
		blowing.sample(3, 4, -2, first);
		(live.time as { now: number }).now = 2;
		blowing.sample(3, 4, -2, later);
		expect(later).not.toEqual(first);
	});
});

/** The forms that make an object, a closure or an iterator in a function that runs each frame. */
const ALLOCATING: readonly (readonly [string, (node: ts.Node) => boolean])[] = [
	['an object literal', ts.isObjectLiteralExpression],
	['an array literal', ts.isArrayLiteralExpression],
	['a function expression', (node) => ts.isFunctionExpression(node) || ts.isArrowFunction(node)],
	['a for-of', ts.isForOfStatement],
	['a new expression', ts.isNewExpression],
];

/** The forms that allocate, anywhere in the functions of `wind.ts` that a frame calls. */
function allocatingForms(): string[] {
	const source = readFileSync(new URL('./wind.ts', import.meta.url), 'utf8');
	const file = ts.createSourceFile('wind.ts', source, ts.ScriptTarget.ESNext, true);
	const wanted = new Set(['write', 'apply', 'turn', 'sample']);
	const found: string[] = [];
	const walk = (node: ts.Node, name: string): void => {
		for (const [what, matches] of ALLOCATING)
			if (matches(node)) found.push(`${name}: ${what} at ${node.getText(file).slice(0, 40)}`);
		node.forEachChild((child) => walk(child, name));
	};
	// The functions are the constants of `createWind`'s body, so the walk goes anywhere in the file.
	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			wanted.has(node.name.text)
		) {
			const name = node.name.text;
			const init = node.initializer;
			const body =
				init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
					? init.body
					: undefined;
			expect(body, `${name} is a function`).toBeDefined();
			if (body !== undefined) {
				wanted.delete(name);
				walk(body, name);
			}
		}
		node.forEachChild(visit);
	};
	visit(file);
	// A renamed or removed function would otherwise leave its rule unchecked.
	expect([...wanted]).toEqual([]);
	return found;
}

describe('the functions that a frame calls', () => {
	test('hold none of the forms that allocate', () => {
		// The field's step writes the air's numbers into the pass's values and reads the camera's
		// place, and the sample walks the ring. The allocator makes each object these forms make, so
		// the step keeps its own arrays and its own functions, made once in `createWind`.
		expect(allocatingForms()).toEqual([]);
	});
});
