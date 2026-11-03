// The task that plans a mesh's levels of detail, which a job worker runs beside the frames (see
// `shared/tasks.ts`). It reads the mesh as the engine core stores it, in the words that
// `meshPlanningArrays` writes, and runs the level planner that the asset tool runs too
// (levels/planner.js), with meshoptimizer's own simplifier. The levels name the mesh's own
// vertices, so the mesh keeps its vertex and triangle order.

import {
	longestSide,
	planMeshLevels,
	type Stream,
	simplifierFlags,
	weldList,
} from '../../levels/planner.js';
import { TaskLoadError } from '../shared/task-load-error';
import type { TaskResult } from '../workers/tasks';
import { type LevelMeshopt, levelMeshopt } from './level-meshopt';
import {
	ENCODER_MODULE,
	holdsAttribute,
	PLANNED_ATTRIBUTES,
	SIMPLIFIER_MODULE,
} from './level-words';

/** What the engine asks of the task. */
export interface LevelsTaskInput {
	/** The words of `meshPlanningArrays`: the counts and format, the floats, then the indices. */
	words: ArrayBuffer;
	/** Whether a list of separate quads counts as leaf cards, whose levels thin them. */
	cards: boolean;
	/** The most lower levels to plan. */
	maxLevels: number;
	/** True to plan nothing for a mesh that lies flat, whose shape a shader may give it. */
	skipFlat: boolean;
}

/** One planned level: its triangles, its error, and its own positions where the step moved them. */
export interface TaskLevel {
	indices: Uint32Array;
	error: number;
	positions?: Float32Array;
}

/** The planned levels, and the time the planner took on the worker, in ms. */
export interface LevelsTaskOutput {
	levels: TaskLevel[];
	/** The mesh's longest side, in the units of its positions and of the errors. */
	side: number;
	ms: number;
}

/** A mesh lies flat when its shortest side is under this share of its longest. */
const FLAT_SHARE = 1e-6;

/**
 * The bytes of meshoptimizer's heaps past which the worker lets them go after a plan. A
 * module's memory never shrinks, so a large mesh's plan would hold its peak for the worker's life;
 * the next plan starts the modules again from their compiled code, which takes a few milliseconds.
 */
const KEPT_HEAP_BYTES = 32 * 1024 * 1024;

/** This worker's planner calls, once started. */
let started: Promise<LevelMeshopt> | undefined;

/** Starts meshoptimizer's modules. A failed start lets the next mesh try again. */
function start(wasm: (name: string) => WebAssembly.Module): Promise<LevelMeshopt> {
	started ??= levelMeshopt(wasm(SIMPLIFIER_MODULE), wasm(ENCODER_MODULE)).catch(
		(error: unknown): never => {
			started = undefined;
			throw new TaskLoadError(error instanceof Error ? error.message : String(error));
		},
	);
	return started;
}

/** The shortest side of the box around a list of points. */
function shortestSide(positions: Float32Array): number {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i++) {
		const v = positions[i] as number;
		const k = i % 3;
		if (v < (min[k] as number)) min[k] = v;
		if (v > (max[k] as number)) max[k] = v;
	}
	return Math.min(...max.map((v, k) => v - (min[k] as number)));
}

/** Plans the levels of the mesh that the words describe. */
export async function run(
	input: unknown,
	wasm: (name: string) => WebAssembly.Module,
): Promise<TaskResult> {
	const { words, cards, maxLevels, skipFlat } = input as LevelsTaskInput;
	const meshopt = await start(wasm);
	const began = performance.now();
	const header = new Uint32Array(words, 0, 3);
	const vertices = header[0] as number;
	const indexCount = header[1] as number;
	const format = header[2] as number;
	const streams = new Map<number, Stream>();
	let at = 12;
	for (const [location, size] of PLANNED_ATTRIBUTES) {
		if (!holdsAttribute(format, location)) continue;
		streams.set(location, { values: new Float32Array(words, at, vertices * size), size });
		at += vertices * size * 4;
	}
	const indices = new Uint32Array(words, at, indexCount);
	const positions = (streams.get(0) as Stream).values;
	const side = longestSide(positions);
	const none = (): TaskResult => ({
		output: { levels: [], side, ms: performance.now() - began } satisfies LevelsTaskOutput,
	});
	if (side === 0 || (skipFlat && shortestSide(positions) <= side * FLAT_SHARE)) return none();
	const list = weldList(
		{
			positions,
			normal: streams.get(1) ?? null,
			color: streams.get(5) ?? null,
			tangent: streams.get(4) ?? null,
			texcoords: [streams.get(2), streams.get(3)].filter((s): s is Stream => s !== undefined),
			indices,
		},
		false,
		side,
		cards,
	);
	const planned = planMeshLevels(
		meshopt,
		[list],
		indexCount / 3,
		side,
		simplifierFlags(false),
		maxLevels,
	);
	const levels: TaskLevel[] = planned.map((level) => ({
		indices: level.indices[0] as Uint32Array,
		error: level.error,
		...(level.positions[0] && { positions: level.positions[0] }),
	}));
	if (meshopt.heapBytes() > KEPT_HEAP_BYTES) started = undefined;
	const output: LevelsTaskOutput = { levels, side, ms: performance.now() - began };
	return {
		output,
		transfer: levels.flatMap((level) =>
			level.positions ? [level.indices.buffer, level.positions.buffer] : [level.indices.buffer],
		),
	};
}
