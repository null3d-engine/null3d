// glTF models: the loader that assets.loadGltf imports the first time, so a page without glTF
// files downloads none of it, nor its worker.
//
// The glTF worker (workers/gltf-worker.ts) parses each file off the sketch's frames, and hands
// back plain data: vertex arrays in the types the file holds them in, the node tree, materials,
// textures, lights and instancing. This thread then downloads what the file names by address
// through `assets`, so the loading counts and preloads cover those files too, and makes the
// engine's meshes, materials and textures, once each. The prefab it returns is a template of the
// file's objects, which `scene.instantiate` copies with one batch of commands. The loader keeps no
// copy of the arrays: the engine copies them into its memory, and the garbage collector frees
// them.
//
// Like the KTX2 loader, this module imports no engine module but constants, types and the prefab
// class, which only it uses. The bundler would move a module that it shares with its thread's
// first file into a file of its own, which every page would then download at its start. So the
// caller hands it the engine's objects and error class.

import type { EngineError } from '../errors/engine-error';
import {
	FLAG_OCCLUDER,
	FLAG_VISIBLE,
	LAYERS_DEFAULT,
	LIGHT_KIND_DIRECTIONAL,
	LIGHT_KIND_POINT,
	LIGHT_KIND_SPOT,
	LIGHT_VALUE_ANGLE,
	LIGHT_VALUE_DECAY,
	LIGHT_VALUE_INTENSITY,
	LIGHT_VALUE_PENUMBRA,
	LIGHT_VALUE_RANGE,
} from '../generated/core';
import { DEV } from '../shared/dev';
import { onEngineStop } from '../shared/helper-workers';
import { compileOnce, type WasmFile } from '../shared/tasks';
import type { WasmError } from '../shared/wasm';
import { bootstrapFailure, spawnWorker } from '../shared/worker-start';
import type { GltfAnswer, GltfDecoder, GltfRequest } from '../workers/gltf-worker';
import { type AnimationRig, destroyRig, loadAnimationRig } from './animation';
import type { FileSource } from './assets';
import { affineOf, multiplyAffine } from './gltf-math';
import type {
	BlockerData,
	GltfData,
	LightData,
	MaterialData,
	MeshData,
	NodeData,
	PrimitiveData,
	TextureUse,
} from './gltf-parse';
import type { CoreMemory } from './memory';
import {
	boundsOf,
	type InstancingTemplate,
	type LightTemplate,
	type MorphTemplate,
	type PartTemplate,
	Prefab,
	type TemplateNode,
} from './prefab';
import type {
	Geometry,
	Material,
	Materials,
	MeshArrays,
	MeshGeometry,
	StandardOptions,
	UnlitOptions,
} from './resources';
import type { Scene } from './scene';
import type { Texture, Textures } from './textures';

/**
 * The illuminance, in lux, below which a point or spot light without a range in its file adds
 * nothing that shows. The engine finds the lights near each surface by their ranges, so such a
 * light ends where its light falls to this, as `sqrt(intensity / cutoff)` meters away.
 */
export const LIGHT_CUTOFF_LUX = 0.001;

/** What the loader takes from the engine. */
export interface GltfContext {
	core: CoreMemory;
	textures: Textures;
	geometry: Geometry;
	materials: Materials;
	/** The scene, whose animation table holds the skeletons and clips of models. */
	scene: Scene;
	/** Downloads a file through `assets`, which counts it and gives failures their codes. */
	download(address: URL, call: string): Promise<Blob>;
	/** Decodes an image file, as `assets.loadImageBitmap` does. */
	decode(
		blob: Blob,
		address: URL,
		colorSpace: 'srgb' | 'linear',
		call: string,
	): Promise<ImageBitmap>;
	/**
	 * Lets the texture memory budget drop a texture's largest mip levels, which the engine then
	 * loads again from the file at `source`, as `assets.loadTexture` does.
	 */
	reloadsFrom(
		texture: Texture,
		source: FileSource,
		colorSpace: 'srgb' | 'linear',
		call: string,
	): void;
	/** Makes one of the engine's coded errors: the caller's `EngineError`. */
	error(
		code: Parameters<WasmError>[0] | 'E1411' | 'E1412' | 'E1416' | 'E1417' | 'E1420',
		message: string,
	): EngineError;
}

/**
 * The decoders that the glTF worker asks for, by name: WebAssembly files that the on-demand loader
 * compiles once per page and sends to the worker.
 */
const DECODERS: Readonly<Record<GltfDecoder, WasmFile>> = {
	meshopt: {
		name: 'meshopt',
		url: new URL('../../vendor/meshopt/meshopt_decoder.wasm', import.meta.url),
		what: 'the meshopt decoder',
	},
};

/** A request that waits for the worker. */
interface Waiting {
	resolve(answer: GltfAnswer): void;
	reject(reason: string): void;
}

/**
 * The glTF worker and the requests that wait for it. A worker that fails to start fails every
 * request, and a later load starts it again.
 */
class Parser {
	private readonly worker: Worker;
	private readonly waiting = new Map<number, Waiting>();
	private next = 0;

	constructor(
		private readonly stopped: () => void,
		error: WasmError,
	) {
		this.worker = spawnWorker(
			() =>
				new Worker(new URL('../workers/gltf-worker.ts', import.meta.url), {
					type: 'module',
					name: 'null3d-gltf',
				}),
			error,
		);
		this.worker.onmessage = (event: MessageEvent<GltfAnswer>) => {
			const waiting = this.waiting.get(event.data.id);
			if (!waiting) return;
			if (!('needs' in event.data)) this.waiting.delete(event.data.id);
			waiting.resolve(event.data);
		};
		this.worker.onerror = (event) => {
			event.preventDefault();
			this.stop(event.message || 'its script did not load');
		};
	}

	/** Stops the worker, and fails every waiting request with `reason`. */
	stop(reason: string): void {
		this.worker.terminate();
		this.stopped();
		for (const { reject } of this.waiting.values()) reject(reason);
		this.waiting.clear();
	}

	/** A new request's id, whose answers go to `resolve` until the last one. */
	start(resolve: Waiting['resolve'], reject: Waiting['reject']): number {
		const id = ++this.next;
		this.waiting.set(id, { resolve, reject });
		return id;
	}

	send(request: GltfRequest, transfer: Transferable[]): void {
		this.worker.postMessage(request, transfer);
	}
}

/** This thread's glTF worker, which starts with the first file. */
let parser: Parser | undefined;

/**
 * Parses a file in the glTF worker, downloading the buffers it names by address on the way, and
 * returns its data and the bitmaps of the images it holds, one for each texture use.
 */
function parse(
	context: GltfContext,
	file: ArrayBuffer,
	address: URL,
	call: string,
): Promise<{ data: GltfData; bitmaps: (ImageBitmap | undefined)[] }> {
	if (!parser) {
		const made: Parser = new Parser(() => {
			forget();
			if (parser === made) parser = undefined;
		}, context.error);
		const forget = onEngineStop(() => made.stop('the engine stopped'));
		parser = made;
	}
	const worker = parser;
	return new Promise((resolve, reject) => {
		const id = worker.start(
			(answer) => {
				if ('error' in answer) {
					const { code, message } = answer.error;
					reject(
						code === 'E1406' || code === 'E1417'
							? context.error(code, `${call}() cannot load ${address}: ${message}.`)
							: code === 'E1412'
								? context.error(code, `${call}() could not decode ${address}: ${message}.`)
								: context.error('E1416', `${call}() could not read ${address}: ${message}.`),
					);
				} else if ('needs' in answer)
					Promise.all([
						Promise.all(
							answer.needs.map(async ([k, url]) => {
								const blob = await context.download(new URL(url), call);
								return [k, await blob.arrayBuffer()] as [number, ArrayBuffer];
							}),
						),
						Promise.all(
							answer.decoders.map(
								async (name) =>
									[name, await compileOnce(DECODERS[name], context.error)] as [
										GltfDecoder,
										WebAssembly.Module,
									],
							),
						),
					]).then(
						([buffers, decoders]) =>
							worker.send(
								{ id, buffers, decoders },
								buffers.map(([, bytes]) => bytes),
							),
						(error) => {
							reject(error);
							// The worker answers a request without its buffers with an error, which
							// frees the file it keeps for the request.
							worker.send({ id, buffers: [] }, []);
						},
					);
				else resolve(answer);
			},
			(reason) =>
				reject(
					bootstrapFailure(reason, context.error) ??
						context.error(
							'E1406',
							`the glTF loader's worker did not load for ${call}(): ${reason}.`,
						),
				),
		);
		worker.send({ id, file, url: address.href }, [file]);
	});
}

/** Loads a glTF file into a prefab. Throws E1416, E1417, E1411, E1412, E1413 or E1406. */
export async function loadGltf(
	context: GltfContext,
	file: Blob,
	address: URL,
	call: string,
): Promise<Prefab> {
	const { data, bitmaps } = await parse(context, await file.arrayBuffer(), address, call);
	// The thread that draws downloads the skinning and morph shader files while the textures
	// decode, so a skinned or morphed model waits less for its pipelines. A skinned mesh's morph
	// targets draw with skinning's builds.
	if (data.nodes.some((n) => n.skinned)) context.materials.shaders.need('skinning');
	if (data.nodes.some((n) => !n.skinned && n.mesh >= 0 && hasMorphTargets(data.meshes[n.mesh])))
		context.materials.shaders.need('morph');
	const textures = await makeTextures(context, data, bitmaps, address, call);
	const materials = new FileMaterials(context, data, textures);
	const made: Made = { meshes: [] };
	try {
		materials.makeBase();
		return await buildPrefab(context, data, textures, materials, made, address, call);
	} catch (error) {
		// A load that fails frees everything it made. No object uses any of it yet.
		materials.destroy();
		for (const texture of textures) texture?.destroy();
		context.geometry.destroyMeshes(made.meshes, call);
		if (made.rig) destroyRig(context.core, made.rig);
		throw error;
	}
}

/** The meshes and the rig that a load made so far, which a failed load frees. */
interface Made {
	meshes: MeshGeometry[];
	rig?: AnimationRig;
}

/** The prefab of a parsed file, once its textures and materials exist. */
async function buildPrefab(
	context: GltfContext,
	data: GltfData,
	textures: readonly (Texture | undefined)[],
	materials: FileMaterials,
	made: Made,
	address: URL,
	call: string,
): Promise<Prefab> {
	// Only the meshes that nodes draw: joints move copies of some of the file's meshes.
	const meshes: (MeshGeometry[] | undefined)[] = [];
	const meshOf = (k: number) => {
		meshes[k] ??= makeMeshes(context, data.meshes[k] as MeshData, made.meshes, address, call);
		return meshes[k];
	};
	const lights = data.lights.map(lightTemplate);
	const rig = await makeRig(context, data, address, call);
	if (rig) made.rig = rig;
	const template: TemplateNode[] = [
		{
			name: '',
			parent: -1,
			transform: IDENTITY,
			flags: FLAG_VISIBLE,
			layers: LAYERS_DEFAULT,
			renderOrder: 0,
			root: true,
		},
	];
	const instancing: InstancingTemplate[] = [];
	/** Each file node's template node, which its children go under, or -1 for a joint. */
	const placed: number[] = [];
	const parents = new Set(data.nodes.map((n) => n.parent));
	const node = (
		fields: Partial<TemplateNode> & Pick<TemplateNode, 'name' | 'parent' | 'transform'>,
	) =>
		template.push({ flags: FLAG_VISIBLE, layers: LAYERS_DEFAULT, renderOrder: 0, ...fields }) - 1;
	for (const [index, n] of data.nodes.entries()) {
		const parent = n.parent < 0 ? 0 : (placed[n.parent] as number);
		const mesh = n.mesh < 0 ? undefined : (data.meshes[n.mesh] as MeshData);
		const made = n.mesh < 0 ? [] : meshOf(n.mesh);
		const parts = (mesh?.primitives ?? []).map((p, k) => ({
			mesh: made[k] as MeshGeometry,
			material: materials.of(p),
			...morphOf(mesh as MeshData, p, n),
			// The asset tool marks the primitives that block the view, as `setOccluder` does.
			...(p.occluder && { flags: FLAG_VISIBLE | FLAG_OCCLUDER }),
		}));
		const light = n.light < 0 ? undefined : lights[n.light];
		if (n.skinned) {
			// Joints move the mesh in the space of the copy's group. A mesh that one joint moves
			// rests where that joint does.
			const rest = n.skin >= 0 ? IDENTITY : n.transform;
			for (const part of parts)
				node({ name: n.name, parent: 0, transform: IDENTITY, ...part, skinned: true, rest });
			const isObject = (n.joint ?? -1) < 0 && parents.has(index);
			placed.push(isObject ? node({ name: n.name, parent, transform: n.transform }) : -1);
			continue;
		}
		if ((n.joint ?? -1) >= 0 && parts.length === 0 && !light) {
			// A joint is no object, and its children went under the copy's group.
			placed.push(-1);
			continue;
		}
		if (n.instancing) {
			const at = node({ name: n.name, parent, transform: n.transform });
			placed.push(at);
			instancing.push({
				node: at,
				...n.instancing,
				parts: parts.map((part) => ({ ...part, matrix: IDENTITY_PART })),
			});
			if (light) node({ name: n.name, parent: at, transform: IDENTITY, light });
			continue;
		}
		if (parts.length === 1 && !light) {
			const [part] = parts as [(typeof parts)[number]];
			placed.push(node({ name: n.name, parent, transform: n.transform, ...part }));
			continue;
		}
		if (parts.length === 0 && light) {
			placed.push(node({ name: n.name, parent, transform: n.transform, light }));
			continue;
		}
		const at = node({ name: n.name, parent, transform: n.transform });
		placed.push(at);
		for (const part of parts) node({ name: n.name, parent: at, transform: IDENTITY, ...part });
		if (light) node({ name: n.name, parent: at, transform: IDENTITY, light });
	}
	const { parts, bounds } = partsOf(template, data, meshes, instancing);
	if (DEV && data.notes.length > 0)
		console.warn(`${call}() left out parts of ${address}: ${data.notes.join('; ')}.`);
	return new Prefab(
		context.core,
		address.href,
		template,
		parts,
		instancing,
		bounds,
		materials.list(),
		textures.filter((t): t is Texture => t !== undefined),
		rig,
		{
			meshes: made.meshes,
			materials: materials.all(),
			geometry: context.geometry,
			error: context.scene.checks.error,
		},
	);
}

const IDENTITY = new Float32Array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
const IDENTITY_PART = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

/** True when a primitive of `mesh` has morph targets. */
const hasMorphTargets = (mesh: MeshData | undefined) =>
	mesh?.primitives.some((p) => Boolean(p.morph)) ?? false;

/**
 * The morph weights of a node's primitive as a template node keeps them: the node's default
 * weights, else the mesh's, and the first joint that animates them, or nothing for a primitive
 * without targets.
 */
function morphOf(mesh: MeshData, p: PrimitiveData, n: NodeData): { morph?: MorphTemplate } {
	if (!p.morph) return {};
	return { morph: { weights: n.weights ?? mesh.weights ?? [], joint: n.morphJoint ?? -1 } };
}

/**
 * The model's skeleton and clips in the engine core, which the job workers resample, or none for a
 * model whose skins and clips move no node. Throws E1416 for a clip that the core refuses.
 */
async function makeRig(
	context: GltfContext,
	data: GltfData,
	address: URL,
	call: string,
): Promise<AnimationRig | undefined> {
	const animation = data.animation;
	if (!animation || animation.joints.length === 0) return undefined;
	try {
		return await loadAnimationRig(context.scene, animation);
	} catch (error) {
		throw context.error(
			'E1416',
			`${call}() could not read the animation of ${address}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * One texture for each texture use: from a bitmap the worker decoded, an image file, or KTX2 data.
 * When one fails, it destroys the others it made, closes the bitmaps it did not use, and throws the
 * first failure. Exported for its tests.
 */
export async function makeTextures(
	context: GltfContext,
	data: GltfData,
	bitmaps: (ImageBitmap | undefined)[],
	address: URL,
	call: string,
): Promise<(Texture | undefined)[]> {
	const files = new Map<string, Promise<Blob>>();
	/** The texture of one use, from its bitmap, its image file or its KTX2 data. */
	const makeTexture = async (
		use: TextureUse,
		bitmap?: ImageBitmap,
	): Promise<Texture | undefined> => {
		const options = {
			colorSpace: use.colorSpace,
			wrap: use.wrap,
			filter: use.filter,
			mipmaps: use.mipmaps,
			uvSet: use.uvSet,
		} as const;
		if (bitmap) return context.textures.fromImage(bitmap, options, 0, call);
		const image = data.images[use.image];
		let bytes = image?.bytes;
		let source = address;
		if (!bytes && image?.url) {
			source = new URL(image.url);
			let file = files.get(image.url);
			if (!file) {
				file = context.download(source, call);
				files.set(image.url, file);
			}
			const blob = await file;
			const head = new Uint8Array(await blob.slice(0, KTX2_IDENTIFIER.length).arrayBuffer());
			if (!isKtx2(head)) {
				const decoded = await context.decode(blob, source, use.colorSpace, call);
				return context.textures.fromImage(decoded, options, 0, call);
			}
			bytes = new Uint8Array(await blob.arrayBuffer());
		}
		if (!bytes) return undefined;
		return ktx2Texture(context, bytes.slice().buffer, source, use, call);
	};
	const results = await Promise.allSettled(
		data.textures.map(async (use, k) => {
			const texture = await makeTexture(use, bitmaps[k]);
			// The texture memory budget may drop the levels of a texture whose file the engine can
			// read again: an image file, or an image inside a buffer of a file.
			const image = data.images[use.image];
			const file: FileSource | undefined = image?.url
				? { url: new URL(image.url) }
				: image?.source && { ...image.source, url: new URL(image.source.url) };
			if (texture && file) context.reloadsFrom(texture, file, use.colorSpace, call);
			return texture;
		}),
	);
	const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
	if (!failed) return results.map((r) => (r as PromiseFulfilledResult<Texture | undefined>).value);
	results.forEach((result, k) => {
		if (result.status === 'fulfilled') result.value?.destroy();
		else bitmaps[k]?.close();
	});
	throw failed.reason;
}

/** A texture from KTX2 data, through the KTX2 loader, which this imports the first time. */
async function ktx2Texture(
	context: GltfContext,
	file: ArrayBuffer,
	address: URL,
	use: TextureUse,
	call: string,
): Promise<Texture> {
	let ktx2: typeof import('./ktx2');
	try {
		ktx2 = await import('./ktx2');
	} catch (error) {
		throw context.error(
			'E1406',
			`the KTX2 loader did not download for ${call}() of ${address}: ${error instanceof Error ? error.message : String(error)}.`,
		);
	}
	const options = {
		colorSpace: use.colorSpace,
		wrap: use.wrap,
		filter: use.filter,
		uvSet: use.uvSet,
	};
	return ktx2.loadKtx2(context.textures, file, address, options, call, (code, message) =>
		context.error(code, message),
	);
}

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

function isKtx2(bytes: Uint8Array): boolean {
	return KTX2_IDENTIFIER.every((byte, k) => bytes[k] === byte);
}

/**
 * The engine's meshes of a glTF mesh, one for each primitive, with the stored tree and the blocker
 * that the asset tool gave each primitive. Each mesh also goes into `out` as it is made.
 */
function makeMeshes(
	context: GltfContext,
	mesh: MeshData,
	out: MeshGeometry[],
	address: URL,
	call: string,
): MeshGeometry[] {
	return mesh.primitives.map((p, k) => {
		const arrays: MeshArrays = {
			positions: p.positions,
			normals: p.normals,
			uvs: p.uvs,
			uvs1: p.uvs1,
			colors: p.colors,
			tangents: p.tangents,
			joints: p.joints,
			weights: p.weights,
			indices: p.indices,
			computeNormals: !p.normals,
			...(p.morph && {
				morphTargets: {
					...p.morph,
					...(mesh.targetNames?.length ? { names: mesh.targetNames } : {}),
				},
			}),
		};
		let made: MeshGeometry;
		try {
			made = context.geometry.fromArrays(arrays);
		} catch (error) {
			// A mesh too large for engine memory keeps its own code, which says how to make room.
			if ((error as { code?: unknown }).code === 'E1109') throw error;
			throw context.error(
				'E1416',
				`${call}() could not read ${address}: primitive ${k} of mesh "${mesh.name}" makes no mesh: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		out.push(made);
		if (p.bvh && !storeTree(context.core, made.id, p.bvh, call) && DEV)
			console.warn(
				`${call}() found a stored tree in ${address} that does not fit primitive ${k} of mesh "${mesh.name}", so raycasts build their own. Optimize the file again.`,
			);
		if (typeof p.occluder === 'object') storeBlocker(context.core, made.id, p.occluder, call);
		return made;
	});
}

/**
 * Gives a mesh the tree over its triangles that the file stores. Returns false when the tree does
 * not fit the mesh, which then gets a tree of its own on the first raycast.
 */
function storeTree(core: CoreMemory, mesh: number, bytes: Uint8Array, call: string): boolean {
	const words = Math.ceil(bytes.byteLength / 4);
	const at = core.checkGrowth(core.glue.meshArrays(words), call);
	new Uint8Array(core.u32(at, words).buffer, at, bytes.byteLength).set(bytes);
	return core.glue.setMeshBvh(mesh, bytes.byteLength) === 1;
}

/** Gives a mesh the blocker that the file stores, which objects with the mesh draw in its place. */
function storeBlocker(core: CoreMemory, mesh: number, blocker: BlockerData, call: string): void {
	const { positions, indices } = blocker;
	const at = core.checkGrowth(core.glue.meshArrays(positions.length + indices.length), call);
	core.f32(at, positions.length).set(positions);
	core.u32(at + positions.byteLength, indices.length).set(indices);
	core.glue.setMeshBlocker(mesh, positions.length / 3, indices.length);
}

/**
 * The engine's materials of a file: one for each of its materials, and one for each other way a
 * primitive draws it, as three.js's GLTFLoader makes them. A primitive with vertex colors turns
 * them on, one without normals shades flat, and one without tangents turns its normal map's
 * green channel over, as three.js does where it finds tangents from screen derivatives.
 */
class FileMaterials {
	private readonly made = new Map<string, Material>();

	private base: Material[] = [];

	constructor(
		private readonly context: GltfContext,
		private readonly data: GltfData,
		private readonly textures: readonly (Texture | undefined)[],
	) {}

	/** Makes a material for each of the file's materials, in its order. */
	makeBase(): void {
		this.base = this.data.materials.map((_, k) => this.variant(k, false, false, true));
	}

	/** The materials in the file's order. */
	list(): Material[] {
		return this.base;
	}

	/** Every material made so far: the file's, and the other ways that primitives draw them. */
	all(): Material[] {
		return [...this.made.values()];
	}

	/** Destroys every material made so far, for a load that fails. */
	destroy(): void {
		for (const material of this.made.values()) material.destroy();
		this.made.clear();
	}

	/** The material that draws a primitive. */
	of(p: PrimitiveData): Material {
		return this.variant(p.material, p.colors !== undefined, !p.normals, p.tangents !== undefined);
	}

	private variant(k: number, vertexColors: boolean, flat: boolean, tangents: boolean): Material {
		const key = `${k} ${vertexColors} ${flat} ${tangents}`;
		let material = this.made.get(key);
		if (!material) {
			material = this.create(this.data.materials[k], vertexColors, flat, tangents);
			this.made.set(key, material);
		}
		return material;
	}

	private create(
		m: MaterialData | undefined,
		vertexColors: boolean,
		flatShading: boolean,
		tangents: boolean,
	): Material {
		const { materials } = this.context;
		if (!m) return materials.standard({ metalness: 1, roughness: 1, vertexColors, flatShading });
		const map = (k: number | undefined) => (k === undefined ? undefined : this.textures[k]);
		const common: UnlitOptions = {
			color: m.color,
			opacity: m.opacity,
			alphaMode: m.alphaMode,
			alphaCutoff: Math.min(m.alphaCutoff, 1),
			doubleSided: m.doubleSided,
			vertexColors,
			uvTransform: m.uvTransform,
			// three.js's GLTFLoader writes no depth for blended materials.
			depthWrite: m.alphaMode !== 'blend',
			map: map(m.maps.map),
		};
		if (m.unlit) return materials.unlit(common);
		const options: StandardOptions = {
			...common,
			flatShading,
			metalness: m.metalness,
			roughness: m.roughness,
			emissive: m.emissive,
			emissiveIntensity: m.emissiveIntensity,
			normalScale: [m.normalScale, tangents ? m.normalScale : -m.normalScale],
			aoMapIntensity: m.aoMapIntensity,
			ior: m.ior,
			specularIntensity: m.specularIntensity,
			specularColor: m.specularColor,
			metalnessRoughnessMap: map(m.maps.metalnessRoughnessMap),
			normalMap: map(m.maps.normalMap),
			aoMap: map(m.maps.aoMap),
			emissiveMap: map(m.maps.emissiveMap),
			specularIntensityMap: map(m.maps.specularIntensityMap),
			specularColorMap: map(m.maps.specularColorMap),
		};
		return materials.standard(options);
	}
}

/** A light's template: its kind and values, with a range where the file gives none. */
function lightTemplate(light: LightData): LightTemplate {
	const values: [number, number][] = [[LIGHT_VALUE_INTENSITY, light.intensity]];
	if (light.type === 'directional')
		return { kind: LIGHT_KIND_DIRECTIONAL, color: light.color, values };
	const brightest = light.intensity * Math.max(...light.color);
	const range =
		light.range > 0 ? light.range : Math.max(Math.sqrt(brightest / LIGHT_CUTOFF_LUX), 1e-3);
	values.push([LIGHT_VALUE_RANGE, range], [LIGHT_VALUE_DECAY, 2]);
	if (light.type === 'point') return { kind: LIGHT_KIND_POINT, color: light.color, values };
	values.push(
		[LIGHT_VALUE_ANGLE, Math.max(light.angle, 1e-4)],
		[LIGHT_VALUE_PENUMBRA, light.penumbra],
	);
	return { kind: LIGHT_KIND_SPOT, color: light.color, values };
}

/**
 * The model's meshes as parts of instance batches, each with its place in the model's space, and
 * the bounds of every mesh in that space, the instances of instancing nodes included.
 */
function partsOf(
	template: readonly TemplateNode[],
	data: GltfData,
	meshes: readonly (MeshGeometry[] | undefined)[],
	instancing: readonly InstancingTemplate[],
): { parts: PartTemplate[]; bounds: ReturnType<typeof boundsOf> } {
	const worlds: Float64Array[] = [];
	const boxes = new Map<MeshGeometry, readonly [number[], number[]]>();
	data.meshes.forEach((mesh, k) => {
		const made = meshes[k];
		if (!made) return;
		mesh.primitives.forEach((p, j) => {
			boxes.set(made[j] as MeshGeometry, [p.min, p.max]);
		});
	});
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	const grow = (m: Float64Array, box: readonly [number[], number[]] | undefined) => {
		if (!box) return;
		for (let corner = 0; corner < 8; corner++) {
			const p = [0, 1, 2].map(
				(axis) => ((corner >> axis) & 1 ? box[1][axis] : box[0][axis]) as number,
			);
			for (let r = 0; r < 3; r++) {
				const v =
					(m[r * 4] as number) * (p[0] as number) +
					(m[r * 4 + 1] as number) * (p[1] as number) +
					(m[r * 4 + 2] as number) * (p[2] as number) +
					(m[r * 4 + 3] as number);
				min[r] = Math.min(min[r] as number, v);
				max[r] = Math.max(max[r] as number, v);
			}
		}
	};
	const parts: PartTemplate[] = [];
	template.forEach((node, k) => {
		// A mesh that a joint moves counts where the joint rests.
		const local = affineOf(node.rest ?? node.transform);
		worlds[k] =
			node.parent < 0 ? local : multiplyAffine(worlds[node.parent] as Float64Array, local);
		const world = worlds[k] as Float64Array;
		if (node.mesh && node.material) {
			parts.push({ mesh: node.mesh, material: node.material, matrix: Float32Array.from(world) });
			grow(world, boxes.get(node.mesh));
		}
	});
	for (const spec of instancing) {
		const world = worlds[spec.node] as Float64Array;
		for (let r = 0; r < spec.count; r++) {
			const row = affineOf([
				...spec.positions.subarray(r * 3, r * 3 + 3),
				...spec.rotations.subarray(r * 4, r * 4 + 4),
				...spec.scales.subarray(r * 3, r * 3 + 3),
			]);
			const placed = multiplyAffine(world, row);
			for (const part of spec.parts) grow(placed, boxes.get(part.mesh));
		}
	}
	const empty = min[0] === Infinity;
	return { parts, bounds: empty ? boundsOf([0, 0, 0], [0, 0, 0]) : boundsOf(min, max) };
}
