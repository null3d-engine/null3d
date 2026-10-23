// The compute pass's options and checks: the compiled shader, its workgroup grid, the target it
// writes and the description that places it. The pass records one dispatch at the description's
// frame point and publishes its target to materials, effects and other passes (D-173, hook H1).
//
// The module holds the shape and the arithmetic alone. The renderer creates the storage target,
// the pipeline and the dispatch; this file refuses an option that no device the engine supports
// could run, before the renderer sees it.

import { EngineError } from '../errors/engine-error';
import type { FeatureDescription } from './features';
import type { CompiledWgsl } from './resources';
import type { TextureValues, UniformValues } from './wgsl-uniforms';

/** The target formats that a compute pass writes. */
export type ComputeFormat = 'rgba16float' | 'r32float' | 'rgba8unorm';

/** The invocations of a compute pass's workgroup along each axis. */
export type WorkgroupSize = readonly [number, number, number];

/**
 * The dispatch's workgroup counts: `'writes'` divides the target's size by the workgroup size,
 * rounding up, or three whole numbers give the counts along each axis.
 */
export type ComputeDispatch = 'writes' | readonly [number, number, number];

/**
 * Options of `render.addPass` for a compute pass, which runs a compiled WGSL compute shader and
 * writes one storage texture. The description places the pass in the frame, and the pass's target
 * is the texture that `textures.fromPass` gives to materials, effects and other passes.
 *
 * @category api/render
 */
export interface ComputePassOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/** `'compute'`: the pass runs `wgsl` once for each workgroup of its dispatch. */
	readonly kind: 'compute';
	/** The feature description that places the pass and publishes its target. */
	readonly description: FeatureDescription;
	/** The compiled WGSL, whose `@compute` entry point writes the storage texture. */
	readonly wgsl: Wgsl;
	/** The name of the storage texture that the pass writes, which `textures.fromPass` reads. */
	readonly writes: string;
	/**
	 * The invocations along each axis. The default is the shader's `@workgroup_size`, which the
	 * engine reads. A value that differs from it throws, so a page cannot dispatch another grid.
	 */
	readonly workgroupSize?: WorkgroupSize;
	/** The workgroup counts. The default is `'writes'`, the target's size divided by the workgroup. */
	readonly dispatch?: ComputeDispatch;
	/** The target's format. The default is `rgba16float`. */
	readonly format?: ComputeFormat;
	/** The target's size in pixels, or leave it out for the render size. */
	readonly size?: readonly [number, number];
	/** The target's share of the render size: 1, 0.5 or 0.25. It and `size` cannot both be given. */
	readonly scale?: number;
	/** The names of the pass targets that the pass reads, which the graph orders it after. */
	readonly reads?: readonly string[];
	/** The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name. */
	readonly textures?: NoInfer<TextureValues<Wgsl>>;
	/** The first value of each uniform, by name. A uniform without one starts at 0. */
	readonly uniforms?: NoInfer<
		[keyof UniformValues<Wgsl>] extends [never]
			? { readonly [name: string]: never }
			: UniformValues<Wgsl>
	>;
	/** The pass runs in one frame of every `every`, from the first. It is 1 by default. */
	readonly every?: number;
	/** The pass's name in `render.dumpGraph()` and errors. It is `writes` by default. */
	readonly name?: string;
}

/** The compiled shader's source at run time, which the public type keeps opaque. */
interface CompiledShaderSource {
	readonly kind: string;
	readonly webgpu?: { readonly wgsl?: { readonly source?: string } | null } | null;
}

/** The formats that a compute pass writes. */
const FORMATS: readonly ComputeFormat[] = ['rgba16float', 'r32float', 'rgba8unorm'];

/** The most invocations that a workgroup holds, which every device the engine supports allows. */
export const COMPUTE_INVOCATIONS = 128;
/** The most invocations along x or y. */
export const COMPUTE_WORKGROUP_XY = 128;
/** The most invocations along z. */
export const COMPUTE_WORKGROUP_Z = 64;
/** The most workgroups along one axis of a dispatch. */
export const COMPUTE_WORKGROUPS = 65_535;

/** E1220 for a compute pass's options that it cannot take. */
function invalid(call: string, detail: string): EngineError {
	return new EngineError('E1220', `${call}() ${detail}`);
}

/** E1215 for WGSL that the plugin did not compile as a compute shader. */
function uncompiled(call: string, wgsl: unknown): EngineError {
	return new EngineError(
		'E1215',
		`${call}() ${
			typeof wgsl === 'string'
				? 'got WGSL as text, which the null3D Vite plugin did not compile. Tag the WGSL with a /* wgsl */ comment, or import it from a .wgsl file.'
				: 'got WGSL that the plugin did not compile as a shader with a @compute entry point.'
		}`,
	);
}

/**
 * The WGSL module of a compiled compute shader, which the engine reads its entry point and
 * workgroup size from. Throws E1215 for WGSL that the plugin did not compile as a whole shader
 * with a `@compute` entry point.
 */
export function computeSource(wgsl: unknown, call = 'render.addPass'): string {
	const compiled = wgsl as CompiledShaderSource | null;
	if (typeof compiled !== 'object' || compiled === null || compiled.kind !== 'shader')
		throw uncompiled(call, wgsl);
	const source = compiled.webgpu?.wgsl?.source;
	if (!source || !/@\s*compute\b/u.test(source)) throw uncompiled(call, wgsl);
	return source;
}

const WORKGROUP = /@\s*workgroup_size\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?(?:,\s*(\d+)\s*)?\)/u;

/**
 * The workgroup size that a shader declares, or undefined when it declares none. A missing axis
 * is 1, as WGSL reads it.
 */
export function workgroupSizeOf(source: string): WorkgroupSize | undefined {
	const match = WORKGROUP.exec(source);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2] ?? 1), Number(match[3] ?? 1)];
}

/**
 * Refuses a workgroup size that a device the engine supports cannot run: from 1 to 128 along x
 * and y, 1 to 64 along z, and at most 128 invocations in all.
 */
export function checkWorkgroup(size: WorkgroupSize, call = 'render.addPass'): void {
	const [x, y, z] = size;
	for (const [axis, value, limit] of [
		['x', x, COMPUTE_WORKGROUP_XY],
		['y', y, COMPUTE_WORKGROUP_XY],
		['z', z, COMPUTE_WORKGROUP_Z],
	] as const)
		if (!Number.isInteger(value) || value < 1 || value > limit)
			throw invalid(
				call,
				`got the workgroup size [${x}, ${y}, ${z}]; ${axis} takes a whole number from 1 to ${limit}.`,
			);
	if (x * y * z > COMPUTE_INVOCATIONS)
		throw invalid(
			call,
			`got the workgroup size [${x}, ${y}, ${z}], which holds ${x * y * z} invocations; a workgroup holds at most ${COMPUTE_INVOCATIONS}.`,
		);
}

/**
 * The workgroup counts of a dispatch: `'writes'` divides the target's size by the workgroup size
 * and rounds up, and three whole numbers give the counts as they are. Every axis stays within
 * the most workgroups that a device takes.
 */
export function dispatchOf(
	size: readonly [number, number],
	workgroup: WorkgroupSize,
	dispatch: ComputeDispatch = 'writes',
	call = 'render.addPass',
): [number, number, number] {
	const counts: [number, number, number] =
		dispatch === 'writes'
			? [Math.ceil(size[0] / workgroup[0]), Math.ceil(size[1] / workgroup[1]), 1]
			: [dispatch[0], dispatch[1], dispatch[2]];
	for (const value of counts)
		if (!Number.isInteger(value) || value < 1 || value > COMPUTE_WORKGROUPS)
			throw invalid(
				call,
				`got the dispatch [${counts.join(', ')}]; each axis takes a whole number from 1 to ${COMPUTE_WORKGROUPS}.`,
			);
	return counts;
}

/**
 * Checks a compute pass's options and returns the workgroup size and target format that the
 * renderer uses. Throws E1220 for an option that a compute pass cannot take, and E1215 for WGSL
 * that is not a compiled compute shader.
 */
export function checkComputeOptions(
	options: ComputePassOptions,
	call = 'render.addPass',
): { readonly workgroup: WorkgroupSize; readonly format: ComputeFormat } {
	if (options.kind !== 'compute')
		throw invalid(call, `got the kind '${String(options.kind)}'; a compute pass takes 'compute'.`);
	if (options.description.kind !== 'compute')
		throw invalid(
			call,
			`got the feature '${options.description.name}' with the kind ${JSON.stringify(options.description.kind)}; a compute pass takes a description with the kind 'compute'.`,
		);
	if (typeof options.writes !== 'string' || options.writes.length === 0)
		throw invalid(call, 'got no writes name; name the storage texture that the pass fills.');
	if (options.size !== undefined && options.scale !== undefined)
		throw invalid(call, 'got both a size and a scale; give one, or neither for the render size.');
	if (options.every !== undefined && (!Number.isInteger(options.every) || options.every < 1))
		throw invalid(call, `got every ${options.every}; it takes a whole number from 1.`);
	const format = options.format ?? 'rgba16float';
	if (!FORMATS.includes(format))
		throw invalid(call, `got the format '${format}'; a compute pass writes ${FORMATS.join(', ')}.`);
	const declared = workgroupSizeOf(computeSource(options.wgsl, call));
	const workgroup = options.workgroupSize ?? declared;
	if (workgroup === undefined)
		throw invalid(
			call,
			'got WGSL with no @workgroup_size and no workgroupSize option; give one of them.',
		);
	checkWorkgroup(workgroup, call);
	if (
		declared !== undefined &&
		(declared[0] !== workgroup[0] || declared[1] !== workgroup[1] || declared[2] !== workgroup[2])
	)
		throw invalid(
			call,
			`got the workgroup size [${workgroup.join(', ')}], and the shader declares [${declared.join(', ')}]. Give the size that the shader declares.`,
		);
	return { workgroup, format };
}
