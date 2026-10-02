import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import { orthographicView } from '../scene/lens';
import { CoreMemory } from '../scene/memory';
import {
	DirectionalLight,
	Object3D,
	OrthographicCamera,
	PerspectiveCamera,
	type Scene,
} from '../scene/scene';
import type { CoreGlue } from '../shared/core';
import type { DebugView } from './debug';
import { DebugDraw, MAX_POINTS, packedColor } from './draw';
import { type DebugHost, SketchDebug } from './sketch-debug';

/** The host of a debug object whose stats nobody reads. */
const HOST: DebugHost = {
	showStats: () => {},
	metrics: new ArrayBuffer(0),
	threads: [],
	sources: { tier: 'webgpu', preset: () => 'high', renderScaleThousandths: () => 1000 },
};

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** One point that a frame drew: its position and its packed color. */
interface Point {
	position: [number, number, number];
	color: number;
}

/** Bytes of one page of WebAssembly memory. */
const PAGE = 65536;

/**
 * A core that keeps the line arrays in a real memory, as the engine core does. Each time the
 * arrays grow they move, keeping their points, as a growing vector can. It records the points of
 * each frame, and gives world matrices from a table.
 */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
	let positionsAt = 0;
	let colorsAt = 0;
	let capacity = 0;
	let end = 8;
	let failure = [0, 0, 0];
	const frames: Point[][] = [];
	const reserves: number[] = [];
	const matrices = new Map<number, number[]>();
	const views: number[] = [];
	const glue = {
		setDebugView(view: number): number {
			views.push(view);
			return 0;
		},
		reserveDebugLines(points: number): number {
			const positions = Math.ceil(end / 8) * 8;
			const colors = positions + points * 24;
			end = colors + points * 4;
			const short = end - memory.buffer.byteLength;
			if (short > 0) memory.grow(Math.ceil(short / PAGE));
			const bytes = new Uint8Array(memory.buffer);
			bytes.copyWithin(positions, positionsAt, positionsAt + capacity * 24);
			bytes.copyWithin(colors, colorsAt, colorsAt + capacity * 4);
			[positionsAt, colorsAt, capacity] = [positions, colors, points];
			reserves.push(points);
			return 0;
		},
		debugLineArrays: (field: number) =>
			field === C.DEBUG_LINE_FIELD_POSITIONS ? positionsAt : colorsAt,
		drawDebugLines(points: number): number {
			if (points > capacity) {
				failure = [1108, points, capacity];
				return 1108;
			}
			const p = new Float64Array(memory.buffer, positionsAt, points * 3);
			const c = new Uint32Array(memory.buffer, colorsAt, points);
			frames.push(
				Array.from({ length: points }, (_, k) => ({
					position: [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]] as [number, number, number],
					color: c[k] as number,
				})),
			);
			return 0;
		},
		worldMatrix(handle: number, out: Float64Array): number {
			const matrix = matrices.get(handle);
			if (!matrix) {
				failure = [1101, handle, 0];
				return 1101;
			}
			out.set(matrix);
			return 0;
		},
		lastErrorCode: () => failure[0] as number,
		lastErrorDetail: (index: number) => failure[1 + index] as number,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	return { core, draw: new DebugDraw(core, HOST), frames, reserves, matrices, memory, views };
}

/** The frames' points, with positions rounded to millimeters for comparison. */
const rounded = (points: Point[]) =>
	points.map(({ position, color }) => ({
		position: position.map((v) => Math.round(v * 1000) / 1000 + 0),
		color,
	}));

/** The lines of a frame: pairs of points. */
const lines = (points: Point[]): [Point, Point][] =>
	Array.from({ length: points.length / 2 }, (_, k) => [
		points[2 * k] as Point,
		points[2 * k + 1] as Point,
	]);

/**
 * The corners of the frustum that a camera at (50, 0, 0) draws on a canvas of the given size, in
 * the default color, after checking that it draws the frustum's twelve edges.
 */
function frustumCorners(
	camera: PerspectiveCamera | OrthographicCamera,
	width: number,
	height: number,
): string[] {
	const { draw, frames, matrices } = fakeCore();
	matrices.set(camera.handle, [1, 0, 0, 50, 0, 1, 0, 0, 0, 0, 1, 0]);
	draw.frustum(camera);
	draw.flush(width, height);
	const edges = lines(frames[0] as Point[]);
	expect(edges.length).toBe(12);
	expect(edges.every(([a]) => a.color === 0xff00aaff)).toBe(true);
	return [...new Set(edges.flat().map((p) => rounded([p])[0]?.position.join() ?? ''))].sort();
}

/** The corners of a box across the -z axis: its x and y ranges at each of two depths. */
function boxCorners(
	[left, right]: [number, number],
	[bottom, top]: [number, number],
	depths: number[],
): string[] {
	return depths
		.flatMap((z) => [
			`${left},${bottom},${-z}`,
			`${right},${bottom},${-z}`,
			`${right},${top},${-z}`,
			`${left},${top},${-z}`,
		])
		.sort();
}

const length = (a: Point, b: Point) =>
	Math.hypot(...a.position.map((v, k) => v - (b.position[k] as number)));

/** An object of the fake scene, whose world matrix the core's table gives. */
const objectAt = (handle: number) => new Object3D({} as Scene, handle, `object ${handle}`);

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

describe('packedColor', () => {
	test('packs hex colors, and linear components as sRGB, with red in the lowest byte', () => {
		expect(packedColor('#ff8800', 'debug.line')).toBe(0xff0088ff);
		expect(packedColor('#48f', 'debug.line')).toBe(0xffff8844);
		expect(packedColor(0x4a8cff, 'debug.line')).toBe(0xffff8c4a);
		// Linear 0.5 is sRGB 0.735, as a hex color's 0xbc.
		expect(packedColor([1, 0.5, 0], 'debug.line')).toBe(0xff00bcff);
	});

	test('throws E1204 for anything else, naming the call', () => {
		for (const color of ['red', '#12345', 0x1000000, [1, 2, 0], [0, 0]]) {
			const error = thrown(() => packedColor(color as never, 'debug.box'));
			expect(error.code).toBe('E1204');
			expect(error.message).toContain('debug.box()');
		}
	});
});

describe('debug drawing', () => {
	test('hands each frame its lines once, then starts empty', () => {
		const { draw, frames } = fakeCore();
		draw.line([0, 1, 2], [3, 4, 5], '#ff0000');
		draw.line([-1, 0, 0], [1, 0, 0]);
		draw.flush(1, 1);
		expect(rounded(frames[0] as Point[])).toEqual([
			{ position: [0, 1, 2], color: 0xff0000ff },
			{ position: [3, 4, 5], color: 0xff0000ff },
			{ position: [-1, 0, 0], color: 0xff00ffff },
			{ position: [1, 0, 0], color: 0xff00ffff },
		]);
		// A frame without calls hands nothing to the core, and the core draws no lines.
		draw.flush(1, 1);
		expect(frames.length).toBe(1);
		draw.line([0, 0, 0], [0, 0, 1]);
		draw.flush(1, 1);
		expect(frames[1]?.length).toBe(2);
	});

	test('keeps 64-bit positions far from the origin', () => {
		const { draw, frames } = fakeCore();
		draw.line([100_000.0125, 1e6 + 0.001, -2], [100_000.0375, 1e6, -2]);
		draw.flush(1, 1);
		const [from, to] = frames[0] as Point[];
		expect(from?.position).toEqual([100_000.0125, 1e6 + 0.001, -2]);
		expect(to?.position).toEqual([100_000.0375, 1e6, -2]);
	});

	test('a box draws its twelve edges between its corners', () => {
		const { draw, frames } = fakeCore();
		draw.box([-1, 0, 2], [3, 1, 4], 0x00ff00);
		draw.flush(1, 1);
		const edges = lines(frames[0] as Point[]);
		expect(edges.length).toBe(12);
		const corners = new Set<string>();
		const lengths: number[] = [];
		for (const [a, b] of edges) {
			corners.add(a.position.join());
			corners.add(b.position.join());
			// Each edge runs along one axis.
			const changed = a.position.filter((v, k) => v !== b.position[k]);
			expect(changed.length).toBe(1);
			lengths.push(length(a, b));
			expect(a.color).toBe(0xff00ff00);
		}
		expect(corners.size).toBe(8);
		expect(lengths.sort((x, y) => x - y)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4]);
	});

	test('a sphere draws three circles whose points lie on it', () => {
		const { draw, frames } = fakeCore();
		draw.sphere([5, -2, 1], 2);
		draw.flush(1, 1);
		const points = frames[0] as Point[];
		expect(points.length).toBe(3 * 32 * 2);
		for (const { position } of points) {
			const distance = Math.hypot(position[0] - 5, position[1] + 2, position[2] - 1);
			expect(distance).toBeCloseTo(2, 9);
		}
	});

	test('an arrow draws its shaft and a head of four lines at its tip', () => {
		const { draw, frames } = fakeCore();
		draw.arrow([1, 1, 1], [0, 0, -3], 2, '#ffffff');
		draw.arrow([0, 0, 0], [0, 0, 0]);
		draw.flush(1, 1);
		const [shaft, ...head] = lines(frames[0] as Point[]);
		expect(head.length).toBe(4);
		expect(rounded(shaft as Point[]).map((p) => p.position)).toEqual([
			[1, 1, 1],
			[1, 1, -1],
		]);
		for (const [tip, side] of head) {
			expect(rounded([tip]).map((p) => p.position)).toEqual([[1, 1, -1]]);
			// Each side sits a fifth of the arrow back from the tip, off the shaft.
			expect(side.position[2]).toBeCloseTo(-0.6, 9);
			expect(Math.hypot(side.position[0] - 1, side.position[1] - 1)).toBeCloseTo(0.12, 9);
		}
	});

	test('axes at a position draw red, green and blue lines along the world axes', () => {
		const { draw, frames } = fakeCore();
		draw.axes([1, 2, 3], 2);
		draw.flush(1, 1);
		expect(rounded(frames[0] as Point[])).toEqual([
			{ position: [1, 2, 3], color: 0xff0000ff },
			{ position: [3, 2, 3], color: 0xff0000ff },
			{ position: [1, 2, 3], color: 0xff00ff00 },
			{ position: [1, 4, 3], color: 0xff00ff00 },
			{ position: [1, 2, 3], color: 0xffff0000 },
			{ position: [1, 2, 5], color: 0xffff0000 },
		]);
	});

	test("an object's axes take its place from the frame's transform update", () => {
		const { draw, frames, matrices } = fakeCore();
		const box = objectAt(7);
		matrices.set(7, [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0]);
		draw.axes(box, 1);
		// The frame moves the object and turns it 90 degrees about y, and doubles its size, before
		// its transform update; the axes follow and keep their size.
		matrices.set(7, [0, 0, 2, 100_000, 0, 2, 0, 5, -2, 0, 0, 0]);
		draw.flush(1, 1);
		expect(rounded(frames[0] as Point[]).map((p) => p.position)).toEqual([
			[100_000, 5, 0],
			[100_000, 5, -1],
			[100_000, 5, 0],
			[100_000, 6, 0],
			[100_000, 5, 0],
			[100_001, 5, 0],
		]);
		// A destroyed object draws nothing.
		draw.axes(box);
		box.destroyedFrame = 3;
		draw.flush(1, 1);
		expect(frames.length).toBe(1);
	});

	test('a grid draws its lines as three.js does, with the center lines in their own color', () => {
		const { draw, frames } = fakeCore();
		draw.grid(4, 4, { center: [0, -1, 10], color: '#ffffff', centerColor: '#000000' });
		draw.flush(1, 1);
		const grid = lines(frames[0] as Point[]);
		expect(grid.length).toBe(10);
		const centered = grid.filter(([a]) => a.color === 0xff000000);
		expect(centered.length).toBe(2);
		for (const [a, b] of grid) {
			expect(a.position[1]).toBe(-1);
			expect(length(a, b)).toBe(4);
		}
		expect(centered.map(([a, b]) => [a.position, b.position].map((p) => p.join())).sort()).toEqual([
			['-2,-1,10', '2,-1,10'],
			['0,-1,8', '0,-1,12'],
		]);
		// An odd number of cells has no center line, and no cell draws nothing.
		draw.grid(3, 3);
		draw.grid(3, 0);
		draw.flush(1, 1);
		const odd = lines(frames[1] as Point[]);
		expect(odd.length).toBe(8);
		expect(odd.every(([a]) => a.color === 0xff888888)).toBe(true);
	});

	test("a perspective camera's frustum draws its near and far planes in the canvas's shape", () => {
		const camera = new PerspectiveCamera({} as Scene, 9, 'eye', 90, 1, 10);
		expect(frustumCorners(camera, 2, 1)).toEqual(
			[...boxCorners([48, 52], [-1, 1], [1]), ...boxCorners([30, 70], [-10, 10], [10])].sort(),
		);
	});

	test("an orthographic camera's frustum is a box, as wide as the canvas's shape makes it", () => {
		const view = orthographicView({ height: 4 });
		const camera = new OrthographicCamera({} as Scene, 9, 'map', view, 1, 10);
		expect(frustumCorners(camera, 2, 1)).toEqual(boxCorners([46, 54], [-2, 2], [1, 10]));
	});

	test("an orthographic camera's frustum keeps the shape and place of the edges it has", () => {
		const view = orthographicView({ left: -3, right: 5, top: 2, bottom: -1 });
		const camera = new OrthographicCamera({} as Scene, 9, 'map', view, 1, 10);
		expect(frustumCorners(camera, 2, 1)).toEqual(boxCorners([47, 55], [-1, 2], [1, 10]));
	});

	test('a directional light draws a square that faces it and an arrow in its direction', () => {
		const { draw, frames, matrices } = fakeCore();
		const scene = { core: { glue: { setLightColor: () => 0 } } } as unknown as Scene;
		const sun = new DirectionalLight(scene, 7, 'sun');
		sun.paint('setColor', C.LIGHT_COLOR_MAIN, '#ff8800');
		// Turned a quarter back about X, so its -Z axis points down, and scaled by 3.
		matrices.set(sun.handle, [3, 0, 0, 5, 0, 0, 3, 6, 0, -3, 0, 7]);
		draw.light(sun, { position: [0, 10, 0], size: 2 });
		draw.light(sun, { color: '#0000ff' });
		draw.flush(1, 1);
		const drawn = lines(frames[0] as Point[]);
		// Four sides, then the arrow: its shaft and four lines of its head, for each drawing.
		expect(drawn.length).toBe(18);
		expect(drawn.slice(0, 9).every(([a]) => a.color === 0xff0088ff)).toBe(true);
		for (const [a, b] of drawn.slice(0, 4)) {
			expect([a.position[1], b.position[1]]).toEqual([10, 10]);
			expect(length(a, b)).toBeCloseTo(2, 9);
		}
		const [start, tip] = drawn[4] as [Point, Point];
		expect(rounded([start, tip]).map((p) => p.position)).toEqual([
			[0, 10, 0],
			[0, 8, 0],
		]);
		// Without a position, the light draws where it is, with a size of 1.
		const [from, to] = drawn[13] as [Point, Point];
		expect(from.color).toBe(0xffff0000);
		expect(rounded([from, to]).map((p) => p.position)).toEqual([
			[5, 6, 7],
			[5, 5, 7],
		]);
	});

	test('the arrays grow by doubling and keep the points of the frame', () => {
		const { draw, frames, reserves } = fakeCore();
		for (let k = 0; k < 3000; k++) draw.line([k, 0, 0], [k, 1, 0]);
		draw.flush(1, 1);
		expect(reserves).toEqual([4096, 8192]);
		const points = frames[0] as Point[];
		expect(points.length).toBe(6000);
		expect(points[0]?.position).toEqual([0, 0, 0]);
		expect(points[5999]?.position).toEqual([2999, 1, 0]);
	});

	test('views follow the memory when it grows between calls', () => {
		const { draw, frames, core, memory } = fakeCore();
		draw.line([1, 2, 3], [4, 5, 6]);
		memory.grow(1);
		core.refresh();
		draw.line([7, 8, 9], [10, 11, 12]);
		draw.flush(1, 1);
		expect((frames[0] as Point[]).map((p) => p.position[0])).toEqual([1, 4, 7, 10]);
	});

	test('a frame draws at most its limit of lines, and warns once', () => {
		const { draw, frames } = fakeCore();
		const warnings: unknown[] = [];
		const warn = console.warn;
		console.warn = (message: unknown) => warnings.push(message);
		try {
			for (let k = 0; k < MAX_POINTS / 2 + 10; k++) draw.line([k, 0, 0], [k, 0, 1]);
			draw.flush(1, 1);
			draw.box([0, 0, 0], [1, 1, 1]);
			draw.flush(1, 1);
		} finally {
			console.warn = warn;
		}
		expect(frames[0]?.length).toBe(MAX_POINTS);
		expect(frames[1]?.length).toBe(24);
		expect(warnings.length).toBe(1);
		expect(String(warnings[0])).toContain('at most 131,072 debug lines');
	});
});

describe('debug.view', () => {
	test("switches the core's shading to each view by its code", () => {
		const { draw, views } = fakeCore();
		for (const view of ['normals', 'depth', 'overdraw', 'wireframe', 'lit'] as const)
			draw.view(view);
		expect(views).toEqual([
			C.DEBUG_VIEW_NORMALS,
			C.DEBUG_VIEW_DEPTH,
			C.DEBUG_VIEW_OVERDRAW,
			C.DEBUG_VIEW_WIREFRAME,
			C.DEBUG_VIEW_LIT,
		]);
	});

	test('refuses a view that it does not know with E1213', () => {
		const { draw, views } = fakeCore();
		expect(() => draw.view('flat' as DebugView)).toThrow(
			`E1213: debug.view() got "flat", which is not 'lit', 'normals', 'depth', 'wireframe' or 'overdraw'.`,
		);
		expect(views).toEqual([]);
	});
});

describe('release builds', () => {
	test('give the sketch drawing calls that do nothing', () => {
		const shapes = ['arrow', 'axes', 'box', 'frustum', 'grid', 'light', 'line', 'sphere', 'view'];
		const release = new SketchDebug(HOST);
		const own = (object: object) =>
			Object.keys(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(object)));
		expect(
			own(release)
				.filter((name) => shapes.includes(name))
				.sort(),
		).toEqual(shapes);
		// The development build's drawing replaces every one of them.
		const { draw } = fakeCore();
		expect(
			own(draw)
				.filter((name) => shapes.includes(name))
				.sort(),
		).toEqual(shapes);
		expect(() => release.line([0, 0, 0], [1, 1, 1], 'not a color')).not.toThrow();
		expect(() => release.view('flat' as DebugView)).not.toThrow();
	});
});
