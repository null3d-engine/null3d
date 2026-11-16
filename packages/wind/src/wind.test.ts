import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Camera, SketchContext } from '@null3d/engine';
import ts from 'typescript';
import { createWind, holdsField } from './wind';

/** Medium's cycle: its 16 pressure steps, the advection and the projection. */
const MEDIUM_CYCLE = 18;
/** The time between Medium's field steps, in seconds. */
const MEDIUM_STEP = 0.033;

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
 * counts the passes that the add-on adds, so a test can tell a device that keeps no grid. `hdr`
 * says whether the engine's probe draws into a float target and reads it back.
 */
function context(
	tier = 'webgpu',
	hdr = tier !== 'webgl2',
	passes?: { count: number },
	steps?: number[],
	options?: unknown[],
	textures: unknown[] = [],
): SketchContext {
	const pass = { enabled: true, live: true, name: 'wind-field', writes: 'wind', place: 1 };
	return {
		time: { now: 1, held: false, drawn: true },
		engine: { capabilities: { tier, hdr } },
		// The feature host reads the preset, the budget and the page's stats channel.
		quality: {
			preset: 'medium',
			settings: {},
			onChange: () => () => {},
			setBudget: (given: { name: string; ms: number }) => ({
				name: given.name,
				scale: 1,
				ms: given.ms,
				remove() {},
			}),
		},
		page: { post: () => {} },
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
	test('every WebGPU path holds it, in either latency mode', () => {
		expect(holdsField({ tier: 'webgpu', hdr: true })).toBe(true);
		// Compatibility mode with MSAA draws into the canvas rather than a float target, yet its
		// compute pass keeps the grid, so the field does not depend on the engine's color path.
		expect(holdsField({ tier: 'webgpu-compat', hdr: false })).toBe(true);
	});

	test('a WebGL2 device holds it only when the engine reads a float target back', () => {
		expect(holdsField({ tier: 'webgl2', hdr: true })).toBe(true);
		// An advertised extension that fails the engine's clear-and-read probe leaves no grid,
		// because the pass's output would then be undefined.
		expect(holdsField({ tier: 'webgl2', hdr: false })).toBe(false);
	});
});

describe('the field that a reader samples', () => {
	test('a device without float targets keeps no grid and gives readers the steady field', () => {
		const passes = { count: 0 };
		const textures: unknown[] = [];
		const wind = createWind(context('webgl2', false, passes, [], [], textures), {
			camera,
			grid: 8,
		});
		// No pass costs the device nothing, and a box of no width sends every sample to the steady
		// field that the sampling function works out, so a plant there still moves.
		expect(passes.count).toBe(0);
		expect(wind.field.size).toBe(0);
		// The stand-in texture is never read, since the box has no width, but it must still be a
		// texture the device takes: four bytes per texel for the default format.
		expect(textures[0]).toMatchObject({ width: 1, height: 1, depth: 1 });
		expect((textures[0] as { data: unknown }).data).toBeInstanceOf(Uint8Array);
		expect(wind.field.air.base).toEqual([4, 0, 0.65, 0]);
		wind.destroy();
	});

	test('the pass keeps its state and runs the steps that the sketch time owes', () => {
		const steps: number[] = [];
		const options: unknown[] = [];
		const ctx = context('webgpu', true, undefined, steps, options);
		const wind = createWind(ctx, { camera, grid: 8 });
		// The field starts when the page makes it, so the first frame owes the cycles since then.
		// Medium runs 16 pressure steps, the advection and the projection, so a cycle is 18 runs.
		expect(options[0]).toMatchObject({
			kind: 'compute',
			history: true,
			format: 'rgba16float',
			steps: MEDIUM_CYCLE,
		});
		expect(steps[0]).toBe(0);
		// A frame that adds one Medium step owes one cycle, and a frame that adds nothing owes none.
		(ctx.time as { now: number }).now = 1 + MEDIUM_STEP;
		wind.update();
		expect(steps[1]).toBe(MEDIUM_CYCLE);
		wind.update();
		expect(steps[2]).toBe(0);
		wind.destroy();
	});

	test('a held page runs the whole hold in its first drawn frame, and only once', () => {
		const steps: number[] = [];
		const ctx = context('webgpu', true, undefined, steps);
		const time = ctx.time as { now: number; held: boolean; drawn: boolean };
		// Hold mode steps the sketch to the held time, and the thread that draws draws only the
		// frames at the end. The steps before them run no pass, so they owe the air to the first
		// frame that draws, and a second frame at the same time owes nothing more.
		time.now = 0;
		time.held = true;
		const wind = createWind(ctx, { camera, grid: 8 });
		for (let step = 0; step <= 60; step++) {
			time.now = step * MEDIUM_STEP;
			time.drawn = step === 60;
			wind.update();
		}
		// Sixty Medium steps of air, all in the one frame that draws.
		expect(steps.slice(1, -1).every((count) => count === 0)).toBe(true);
		expect(steps.at(-1)).toBe(60 * MEDIUM_CYCLE);
		wind.update();
		expect(steps.at(-1)).toBe(0);
		wind.destroy();
	});

	test('a held frame drawn after the frame before it adds only the step between them', () => {
		const steps: number[] = [];
		const ctx = context('webgpu', true, undefined, steps);
		const time = ctx.time as { now: number; held: boolean; drawn: boolean };
		// A held frame whose passes read the frame before it, as motion vectors do, draws that
		// frame too. Each drawn frame then runs only its own share of the hold.
		time.now = 0;
		time.held = true;
		const wind = createWind(ctx, { camera, grid: 8 });
		for (let step = 0; step <= 60; step++) {
			time.now = step * MEDIUM_STEP;
			time.drawn = step >= 59;
			wind.update();
		}
		expect(steps.at(-2)).toBe(59 * MEDIUM_CYCLE);
		expect(steps.at(-1)).toBe(MEDIUM_CYCLE);
		wind.destroy();
	});

	test('a stall skips the air that it missed instead of paying for it later', () => {
		const steps: number[] = [];
		const ctx = context('webgpu', true, undefined, steps);
		(ctx.time as { now: number }).now = 0;
		const wind = createWind(ctx, { camera, grid: 8 });
		// A frame that arrives twenty sketch seconds late runs one frame's worth of air: the most
		// that a frame runs is 600 cycles.
		(ctx.time as { now: number }).now = 20;
		wind.update();
		expect(steps.at(-1)).toBe(600 * MEDIUM_CYCLE);
		// The next frame owes nothing extra, so the stall left no debt behind it.
		wind.update();
		expect(steps.at(-1)).toBe(0);
		wind.destroy();
	});

	test('a box of no width keeps no grid either, so every sample is the steady field', () => {
		const passes = { count: 0 };
		const wind = createWind(context('webgpu', true, passes), { camera, box: 0, grid: 8 });
		expect(passes.count).toBe(0);
		expect(wind.field.size).toBe(0);
		wind.destroy();
	});

	test('a device that holds the field takes its box, and each reader reads the settings', () => {
		const passes = { count: 0 };
		const wind = createWind(context('webgpu', true, passes), { camera, box: 96, grid: 8 });
		expect(passes.count).toBe(1);
		expect(wind.field.size).toBe(96);
		// The reading follows the steady wind, so a reader that works out the far field keeps step.
		wind.setBase(9, 0.5);
		expect(wind.field.air.base[0]).toBe(9);
		expect(wind.field.air.base[1]).toBe(0.5);
		wind.destroy();
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
		wind.destroy();
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
		// One wind fills a scene, so the add-on's feature goes before the next one starts.
		still.destroy();

		const live = context();
		const blowing = createWind(live, { camera, grid: 8 });
		blowing.sample(3, 4, -2, first);
		(live.time as { now: number }).now = 2;
		blowing.sample(3, 4, -2, later);
		expect(later).not.toEqual(first);
		blowing.destroy();
	});
});

/** The body of the `read` method that `createWind` returns, as the text of the code. */
function readBody(): string {
	const source = readFileSync(new URL('./wind.ts', import.meta.url), 'utf8');
	const file = ts.createSourceFile('wind.ts', source, ts.ScriptTarget.ESNext, true);
	let body: string | undefined;
	const visit = (node: ts.Node): void => {
		if (
			ts.isMethodDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === 'read' &&
			node.body !== undefined
		)
			body = node.body.getText(file);
		node.forEachChild(visit);
	};
	visit(file);
	expect(body, 'read is a method of the wind').toBeDefined();
	return body as string;
}

describe('the air that a frame asks for', () => {
	test('comes from the job worker, never from the TypeScript field', () => {
		// A page without job workers gets the engine's task worker, and a task that fails is reported
		// once. Nothing in the call falls back to the mirror, which would be a frame loop in
		// TypeScript.
		const body = readBody();
		expect(body).toContain('probes.ask');
		expect(body).not.toMatch(/analyticVelocity/);
		expect(body).not.toMatch(/\bsample\b/);
	});

	test('has no TypeScript field in the ask path to answer in its place', () => {
		const field = readFileSync(new URL('./field.ts', import.meta.url), 'utf8');
		const task = readFileSync(new URL('./field-task.ts', import.meta.url), 'utf8');
		expect(field).not.toMatch(/analyticVelocity|value3/);
		expect(task).not.toMatch(/analyticVelocity|value3|from '\.\/analytic'/);
		// The one import of the mirror in the ask path gives a type alone, which the build drops.
		const mirrorImports = field.match(/import[^;]*from '\.\/analytic'/g) ?? [];
		expect(mirrorImports.every((line) => line.startsWith('import type'))).toBe(true);
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

/** The forms that walk a count in TypeScript, which hard rule 42 puts in Rust. */
const LOOPING: readonly (readonly [string, (node: ts.Node) => boolean])[] = [
	['a for', ts.isForStatement],
	['a for-in', ts.isForInStatement],
	['a for-of', ts.isForOfStatement],
	['a while', ts.isWhileStatement],
	['a do', ts.isDoStatement],
];

/** A file of the ask path, and the functions in it that a frame runs. */
interface Scanned {
	readonly file: string;
	readonly names: readonly string[];
}

/** The functions that a frame runs, in each file of the ask path. */
const FRAME_FILES: readonly Scanned[] = [
	{ file: 'wind.ts', names: ['write', 'apply', 'turn', 'sample', 'read'] },
	{ file: 'field.ts', names: ['ask', 'send', 'answered', 'refused', 'reportDrop'] },
	{ file: 'field-layout.ts', names: ['fillRequest'] },
];

/** The same, with the buffer's growth, which a call may run when a page first asks for more places. */
const LOOP_FILES: readonly Scanned[] = [
	FRAME_FILES[0] as Scanned,
	{ file: 'field.ts', names: ['ask', 'send', 'answered', 'refused', 'reportDrop', 'reserve'] },
	FRAME_FILES[2] as Scanned,
];

/** The name of the function that a declaration or a declaration's arrow makes, if any. */
function functionName(node: ts.Node): string | undefined {
	if (
		(ts.isFunctionDeclaration(node) ||
			ts.isMethodDeclaration(node) ||
			ts.isVariableDeclaration(node) ||
			ts.isPropertyDeclaration(node)) &&
		node.name !== undefined &&
		ts.isIdentifier(node.name)
	)
		return node.name.text;
	return undefined;
}

/** The body of a function that a declaration makes, if any. */
function functionBody(node: ts.Node): ts.Node | undefined {
	if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return node.body;
	if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
		const init = node.initializer;
		return init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
			? init.body
			: undefined;
	}
	return undefined;
}

/**
 * The forms of `patterns`, anywhere in the functions that `files` names. A function is a
 * declaration, a method of a class or an object, or a constant given an arrow. A name that no file
 * holds fails the test, so a renamed or removed function leaves no rule unchecked.
 */
function formsIn(
	files: readonly Scanned[],
	patterns: readonly (readonly [string, (node: ts.Node) => boolean])[],
): string[] {
	const found: string[] = [];
	for (const { file, names } of files) {
		const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
		const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
		const wanted = new Set(names);
		const walk = (node: ts.Node, name: string): void => {
			for (const [what, matches] of patterns)
				if (matches(node)) found.push(`${name}: ${what} at ${node.getText(parsed).slice(0, 40)}`);
			node.forEachChild((child) => walk(child, name));
		};
		const visit = (node: ts.Node): void => {
			const name = functionName(node);
			if (name !== undefined && wanted.has(name)) {
				const body = functionBody(node);
				expect(body, `${file}: ${name} is a function`).toBeDefined();
				if (body !== undefined) {
					wanted.delete(name);
					walk(body, `${file}: ${name}`);
				}
			}
			node.forEachChild(visit);
		};
		visit(parsed);
		expect([...wanted], `${file} holds every function that the rule names`).toEqual([]);
	}
	return found;
}

describe('the functions that a frame calls', () => {
	test('hold none of the forms that allocate', () => {
		// The field's step writes the air's numbers into the pass's values and reads the camera's
		// place, a push writes its slot where the page sends it, and the read hands the request
		// buffer to a job worker. The allocator makes each object these forms make, so the step
		// keeps its own arrays and its own functions, made once in `createWind`.
		expect(formsIn(FRAME_FILES, ALLOCATING)).toEqual([]);
	});

	test('walk no count in TypeScript, which hard rule 42 puts in its WebAssembly', () => {
		// The pass's values hold the ring where a push writes it, so a frame copies no slot, and the
		// analytic field's own walk runs in the add-on's Rust, on the job workers. The ask path has
		// no loop either: the request is a set of typed-array writes and the task does the walk.
		expect(formsIn(LOOP_FILES, LOOPING)).toEqual([]);
	});
});
