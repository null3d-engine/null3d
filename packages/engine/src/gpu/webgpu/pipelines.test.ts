import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as G from '../../generated/gpu';
import { type DeviceShaders, everyShader, type ShaderVariants } from '../../generated/shaders';
import type { CustomShader } from '../../shared/images';
import { Pipelines } from './pipelines';

const scope = globalThis as Record<string, unknown>;
const GLOBALS = { GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 } };
beforeAll(() => Object.assign(scope, GLOBALS));
afterAll(() => {
	for (const name of Object.keys(GLOBALS)) delete scope[name];
});

/** Every shader build the shader compiler wrote, as this device's pipeline builders see them. */
const SHADERS = await everyShader();

/** WebGPU's default limits, which every device offers and the engine stays within. */
const LIMITS = {
	sampledTextures: 16,
	samplers: 16,
	uniformBuffers: 12,
	storageBuffers: 8,
	storageTextures: 4,
	bindGroups: 4,
	bindGroupsPlusVertexBuffers: 24,
	dynamicUniformBuffers: 8,
	dynamicStorageBuffers: 4,
};

const STAGES = { vertex: 1, fragment: 2, compute: 4 };

/** The permutation bits of a custom shader that change its pipeline layout. */
const CUSTOM_BITS = {
	SKIN: G.PERMUTATION_SKIN,
	INSTANCE_INDEX: G.PERMUTATION_INSTANCE_INDEX,
	DEPTH_MULTISAMPLED: G.PERMUTATION_DEPTH_MULTISAMPLED,
};

/** Every combination of the bits of `bits`. */
function combinations(bits: number): number[] {
	const words = [0];
	for (let bit = 1; bit !== 0 && bit <= bits; bit = (bit << 1) >>> 0)
		if (bits & bit) for (const word of [...words]) words.push((word | bit) >>> 0);
	return words;
}

/**
 * A shader a sketch wrote: a build for each combination of `bits`, whose every pipeline has the
 * entry points that the templates ask for.
 */
function customShaders(name: string, bits: number): ShaderVariants {
	const pipelines = new Proxy({}, { get: () => ({ vertex: 'vs', fragment: 'fs' }) });
	return Object.fromEntries(
		combinations(bits).map((permutation) => [
			`${name} ${permutation}`,
			{ permutation, wgsl: { source: name, pipelines }, glsl: null },
		]),
	) as ShaderVariants;
}

/** The device's shaders, by name, from the builds that the shader compiler wrote. */
function deviceShaders(): DeviceShaders {
	return new Proxy({} as DeviceShaders, {
		get(_, name) {
			if (typeof name !== 'string') return undefined;
			const shader = SHADERS[name];
			if (!shader) throw new Error(`the shader compiler wrote no shader ${name}`);
			return shader;
		},
	});
}

/** A device whose layouts are their descriptors, so a pipeline's descriptor shows its groups. */
function fakeDevice(): GPUDevice {
	return {
		createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => descriptor,
		createPipelineLayout: (descriptor: GPUPipelineLayoutDescriptor) => descriptor,
		createShaderModule: () => ({}),
	} as unknown as GPUDevice;
}

/** The resources of each kind that `entries` give one shader stage. */
function stageCounts(entries: readonly GPUBindGroupLayoutEntry[], stage: number) {
	const seen = entries.filter((entry) => (entry.visibility & stage) !== 0);
	const buffers = (type: string) =>
		seen.filter((entry) => entry.buffer && (entry.buffer.type ?? 'uniform') === type).length;
	return {
		sampledTextures: seen.filter((entry) => entry.texture).length,
		samplers: seen.filter((entry) => entry.sampler).length,
		uniformBuffers: buffers('uniform'),
		storageBuffers: buffers('storage') + buffers('read-only-storage'),
		storageTextures: seen.filter((entry) => entry.storageTexture).length,
	};
}

/**
 * The faults of a pipeline layout against the default limits: each stage's resources summed over
 * its groups, its groups with the vertex buffers, and its dynamic buffers. WebGPU counts a stage's
 * resources over every entry of every group of the layout, whether or not the shader reads them,
 * so this is what the device validates.
 */
function faults(layout: GPUPipelineLayoutDescriptor, vertexBuffers: number): string[] {
	const groups = [...layout.bindGroupLayouts] as unknown as GPUBindGroupLayoutDescriptor[];
	const entries = groups.flatMap((group) => [...group.entries]);
	const found: string[] = [];
	const check = (what: string, count: number, limit: number) => {
		if (count > limit) found.push(`${what}: ${count} of ${limit}`);
	};
	for (const [name, stage] of Object.entries(STAGES)) {
		const counts = stageCounts(entries, stage);
		for (const [kind, count] of Object.entries(counts))
			check(`${name} ${kind}`, count, LIMITS[kind as keyof typeof counts]);
	}
	check('bind groups', groups.length, LIMITS.bindGroups);
	check(
		'bind groups and vertex buffers',
		groups.length + vertexBuffers,
		LIMITS.bindGroupsPlusVertexBuffers,
	);
	const dynamic = (type: string) =>
		entries.filter(
			(entry) => entry.buffer?.hasDynamicOffset && (entry.buffer.type ?? 'uniform') === type,
		).length;
	check('dynamic uniform buffers', dynamic('uniform'), LIMITS.dynamicUniformBuffers);
	check(
		'dynamic storage buffers',
		dynamic('storage') + dynamic('read-only-storage'),
		LIMITS.dynamicStorageBuffers,
	);
	return found;
}

/**
 * The descriptor of a pipeline of render template `id` that draws color and depth, with a vertex
 * format that offers every attribute a shader can read.
 */
function renderDescriptor(pipelines: Pipelines, id: number, permutation: number) {
	return pipelines.render(id, permutation, 'rgba8unorm', 'depth32float', 1, 0, G.VERTEX_ALL, 0, 0);
}

/** The layout of a pipeline that the fake device made, as its descriptor. */
function layoutOf(descriptor: GPURenderPipelineDescriptor | GPUComputePipelineDescriptor) {
	return descriptor.layout as unknown as GPUPipelineLayoutDescriptor;
}

/**
 * The faults of every build of render template `id` that its shader has on this device, by build.
 * A build the shader lacks is one the engine never makes a pipeline from, so it is no fault.
 */
function templateFaults(pipelines: Pipelines, id: number): string[] {
	const found: string[] = [];
	for (const { permutation, wgsl } of Object.values(pipelines.variants(id))) {
		if (!wgsl) continue;
		const descriptor = renderDescriptor(pipelines, id, permutation);
		const buffers = [...(descriptor.vertex.buffers ?? [])].length;
		for (const fault of faults(layoutOf(descriptor), buffers))
			found.push(`${descriptor.label} (permutation ${permutation}): ${fault}`);
	}
	return found;
}

/** Every render template that the engine defines, by id. */
function renderTemplates(pipelines: Pipelines): number[] {
	return Array.from({ length: G.TEMPLATE_CUSTOM_FIRST }, (_, id) => id).filter((id) =>
		pipelines.has(id),
	);
}

/** A custom shader of `kind` that declares `textures` textures, with builds for `bits`. */
function custom(kind: CustomShader['kind'], textures: number, bits: number): CustomShader {
	return { kind, variants: customShaders(`custom ${kind}`, bits), locations: [0, 1, 2], textures };
}

describe('the WebGPU pipeline layouts', () => {
	// Every template's every build, which is a few thousand pipelines, so this takes seconds.
	it('keep every build of every template within the default limits per shader stage', () => {
		const pipelines = new Pipelines(fakeDevice(), deviceShaders());
		const templates = renderTemplates(pipelines);
		expect(templates).toContain(G.TEMPLATE_DECAL_MAPS);
		expect(templates.flatMap((id) => templateFaults(pipelines, id))).toEqual([]);
	}, 120_000);

	it('keep custom materials and effects with textures within the default limits', () => {
		const pipelines = new Pipelines(fakeDevice(), deviceShaders());
		const meshBits = G.PERMUTATION_SKIN | G.PERMUTATION_INSTANCE_INDEX | G.PERMUTATION_CASTER;
		const shaders = [
			custom(undefined, 0, meshBits),
			custom(undefined, G.SIZE_MAP_SLOTS, meshBits),
			custom('effect', G.SIZE_MAP_SLOTS, G.PERMUTATION_DEPTH_MULTISAMPLED),
			custom('effectGroup', 0, G.PERMUTATION_DEPTH_MULTISAMPLED),
			custom('effectFold', 0, G.PERMUTATION_DEPTH_MULTISAMPLED),
			custom('final', 0, 0),
			custom('finalBloom', 0, 0),
		];
		const found: string[] = [];
		for (const [k, shader] of shaders.entries()) {
			const id = G.TEMPLATE_CUSTOM_FIRST + k;
			pipelines.defineCustom(id, shader);
			found.push(...templateFaults(pipelines, id));
		}
		expect(found).toEqual([]);
	});

	it('keep the compute pipelines within the default limits', () => {
		const pipelines = new Pipelines(fakeDevice(), deviceShaders());
		const found: string[] = [];
		for (const id of [
			G.TEMPLATE_CULL,
			G.TEMPLATE_OCCLUSION_EARLY,
			G.TEMPLATE_OCCLUSION_LATE,
			G.TEMPLATE_DEPTH_PYRAMID,
			G.TEMPLATE_SKIN,
			G.TEMPLATE_EXPOSURE_HISTOGRAM,
			G.TEMPLATE_EXPOSURE_ADAPT_HISTOGRAM,
			G.TEMPLATE_LIGHT_COUNT,
			G.TEMPLATE_LIGHT_PLACE,
			G.TEMPLATE_LIGHT_WRITE,
		]) {
			const descriptor = pipelines.compute(id, 0);
			for (const fault of faults(layoutOf(descriptor), 0))
				found.push(`${descriptor.label}: ${fault}`);
		}
		expect(found).toEqual([]);
	});

	it('give a decal with maps a frame group without the probe grid and the opaque color copy', () => {
		const pipelines = new Pipelines(fakeDevice(), deviceShaders());
		const layout = layoutOf(renderDescriptor(pipelines, G.TEMPLATE_DECAL_MAPS, 0));
		const groups = [...layout.bindGroupLayouts] as unknown as GPUBindGroupLayoutDescriptor[];
		const frame = groups[0];
		const bindings = [...(frame?.entries ?? [])].map((entry) => entry.binding);
		expect(frame?.label).toBe('decal frame');
		expect(bindings).not.toContain(10);
		expect(bindings).not.toContain(15);
		const entries = groups.flatMap((group) => [...group.entries]);
		expect(stageCounts(entries, STAGES.fragment).sampledTextures).toBe(15);
	});
});
