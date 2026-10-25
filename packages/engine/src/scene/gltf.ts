// glTF models: the loader that assets.loadGltf imports the first time, so a page without glTF
// files downloads none of it, nor its worker.
//
// The glTF worker (workers/gltf-worker.ts) parses each file off the sketch's frames, and hands
// back plain data: vertex arrays in the types the file holds them in, the node tree, materials,
// textures, lights, instancing, and the primitives of the extensions that add-ons registered
// handlers for. This thread then downloads what the file names by address through `assets`, so the
// loading counts and preloads cover those files too, and makes the engine's meshes, materials and
// textures, once each. It hands each registered extension its primitives, and draws what the
// handler returns. The prefab it returns is a template of the file's objects, which
// `scene.instantiate` copies with one batch of commands. The loader keeps no copy of the arrays:
// the engine copies them into its memory, and the garbage collector frees them.
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
import { bootstrapFailure, spawnWorker, watchWorkerError } from '../shared/worker-start';
import type { GltfAnswer, GltfDecoder, GltfRequest } from '../workers/gltf-worker';
import { type AnimationRig, destroyRig, loadAnimationRig } from './animation';
import type {
	FileSource,
	GltfExtensionData,
	GltfExtensionHandler,
	GltfExtensionPart,
	LoadGltfOptions,
} from './assets';
import type { RigJoint, RigPropertyTarget } from './gltf-animation';
import { affineOf, growBox, multiplyAffine } from './gltf-math';
import type {
	BlockerData,
	GltfData,
	LightData,
	MaterialData,
	MeshData,
	NodeData,
	NodeLevels,
	PatchesData,
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
	type PropertyAnimationData,
	type TemplateNode,
} from './prefab';
import {
	PROPERTY_LIGHT_ANGLE,
	PROPERTY_LIGHT_COLOR,
	PROPERTY_LIGHT_INTENSITY,
	PROPERTY_LIGHT_RANGE,
	PROPERTY_MATERIAL,
	PROPERTY_VISIBLE,
	type PropertyBinding,
	type PropertyTrack,
} from './property-animation';
import type {
	Geometry,
	Material,
	Materials,
	MeshArrays,
	MeshGeometry,
	MeshLevel,
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
		code: Parameters<WasmError>[0] | 'E1213' | 'E1411' | 'E1412' | 'E1416' | 'E1417' | 'E1420',
		message: string,
	): EngineError;
	/** The handlers that add-ons registered for glTF extensions, if the page loaded any. */
	extensionHandlers: readonly GltfExtensionHandler[];
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
	draco: {
		name: 'draco',
		url: new URL('../../vendor/draco/draco_decoder_gltf.wasm', import.meta.url),
		what: 'the Draco decoder',
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
		watchWorkerError(this.worker, (message) => this.stop(message || 'its script did not load'));
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
		worker.send(
			{
				id,
				file,
				url: address.href,
				extensions: [...new Set(context.extensionHandlers.flatMap((h) => h.extensions))],
			},
			[file],
		);
	});
}

/** Loads a glTF file into a prefab. Throws E1416, E1417, E1411, E1412, E1413 or E1406. */
export async function loadGltf(
	context: GltfContext,
	file: Blob,
	address: URL,
	call: string,
	options: LoadGltfOptions = {},
): Promise<Prefab> {
	const { data, bitmaps } = await parse(context, await file.arrayBuffer(), address, call);
	return makePrefab(context, data, bitmaps, address, call, options);
}

/**
 * Makes the prefab of a parsed file: its textures, materials, extension handlers' parts and
 * objects. Exported for its tests.
 */
export async function makePrefab(
	context: GltfContext,
	data: GltfData,
	bitmaps: (ImageBitmap | undefined)[],
	address: URL,
	call: string,
	options: LoadGltfOptions = {},
): Promise<Prefab> {
	// The thread that draws downloads the shader files of the features that the asset tool
	// recorded with the file (its `NULL3D_shaders` list), and then the skinning and morph shader
	// files of a file without such a list, while the textures decode. So a model waits less for
	// its pipelines. A skinned mesh's morph targets draw with skinning's builds.
	if (data.shaders) context.materials.shaders.needListed(data.shaders.features);
	if (data.nodes.some((n) => n.skinned)) context.materials.shaders.need('skinning');
	if (data.nodes.some((n) => !n.skinned && n.mesh >= 0 && hasMorphTargets(data.meshes[n.mesh])))
		context.materials.shaders.need('morph');
	const textures = await makeTextures(context, data, bitmaps, address, call);
	const materials = new FileMaterials(context, data, textures);
	const made: Made = { meshes: [] };
	try {
		materials.makeBase();
		const parts = await makeExtensionParts(context, data, materials, made, call);
		const staged = new Map<number, StagedNode>();
		const prefab = await buildPrefab(
			context,
			data,
			textures,
			materials,
			made,
			parts,
			address,
			call,
			staged,
		);
		// The file draws its coarsest level, which the prefab holds: the finer levels download while
		// the sketch draws it, so a model never waits for the whole file.
		if (staged.size > 0)
			startStages(context, prefab, staged.values(), made.meshes, options, address, call);
		return prefab;
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

/** A part that an add-on's extension handler draws at a node. */
interface HandlerPart {
	mesh: MeshGeometry;
	material: Material;
}

/**
 * The parts that the add-ons' extension handlers draw, by the index of the node that holds them.
 * A handler gets each primitive that carries one of its extensions, with the node's place, the
 * primitive's attributes and material, and the engine's geometry and material makers. The meshes
 * and materials that it returns join the model, so a copy draws them and `destroy` frees them.
 */
async function makeExtensionParts(
	context: GltfContext,
	data: GltfData,
	materials: FileMaterials,
	made: Made,
	call: string,
): Promise<Map<number, HandlerPart[]>> {
	const handlers = new Map<string, GltfExtensionHandler>();
	for (const handler of context.extensionHandlers)
		for (const name of handler.extensions) handlers.set(name, handler);
	const parts = new Map<number, HandlerPart[]>();
	if (handlers.size === 0) return parts;
	for (const [index, node] of data.nodes.entries()) {
		const mesh = node.mesh < 0 ? undefined : data.meshes[node.mesh];
		for (const primitive of mesh?.extensionPrimitives ?? []) {
			for (const { name, json } of primitive.extensions) {
				const handler = handlers.get(name);
				if (!handler) continue;
				const returned = await handler.load(
					{
						extension: name,
						json,
						node: nodeOf(node),
						primitive: {
							attributes: primitive.attributes,
							count: primitive.count,
							indices: primitive.indices,
							mode: primitive.mode,
							material: materials.ofExtension(primitive.material),
						},
					},
					{ geometry: context.geometry, materials: context.materials },
				);
				const returnedParts: readonly GltfExtensionPart[] =
					returned === undefined
						? []
						: Array.isArray(returned)
							? returned
							: [returned as GltfExtensionPart];
				const at = parts.get(index) ?? [];
				for (const part of returnedParts) {
					if (!part.mesh || !part.material)
						throw context.error(
							'E1213',
							`${call}() got a part from the handler for ${name} without a mesh or a material. Return the mesh and material that the part draws.`,
						);
					if (!made.meshes.includes(part.mesh)) made.meshes.push(part.mesh);
					materials.own(part.material);
					at.push({ mesh: part.mesh, material: part.material });
				}
				if (at.length > 0) parts.set(index, at);
			}
		}
	}
	return parts;
}

/** A parsed node's name and place, as an extension handler gets them. */
function nodeOf(node: NodeData): GltfExtensionData['node'] {
	const t = node.transform;
	return {
		name: node.name,
		position: [t[0] as number, t[1] as number, t[2] as number],
		rotation: [t[3] as number, t[4] as number, t[5] as number, t[6] as number],
		scale: [t[7] as number, t[8] as number, t[9] as number],
	};
}

/** The glTF names of the attributes that a primitive's vertices hold. */
const ATTRIBUTE_NAMES = [
	'POSITION',
	'NORMAL',
	'TEXCOORD_0',
	'TEXCOORD_1',
	'COLOR_0',
	'TANGENT',
	'JOINTS_0',
	'WEIGHTS_0',
] as const;

/**
 * True when a level primitive's vertices are its base primitive's own: the file names the same
 * accessor for every attribute. The asset tool writes levels that way, which lets the engine store
 * a level as its base's vertices with other indices: the planner simplifies by dropping vertices,
 * so a level names a subset of the base's accessor in the same order. A level that names an
 * accessor of its own, or whose base mesh the engine had to split into parts, copies the vertices
 * instead.
 */
export function sharesVertices(
	level: PrimitiveData | undefined,
	base: PrimitiveData | undefined,
): boolean {
	if (level === undefined || base === undefined) return false;
	if (level.indices === undefined) return false;
	const one = level.accessors;
	const other = base.accessors;
	if (one === undefined || other === undefined) return false;
	// A level carries no morph targets, so a morphed base keeps copies. A skinned base shares them:
	// its skin moves the same vertices whichever level names them.
	if (base.morph !== undefined || base.normals === undefined) return false;
	return ATTRIBUTE_NAMES.every((name) => one[name] === other[name]);
}

/**
 * Gives each primitive's mesh of a node the levels of detail that `MSFT_lod` names: the same
 * primitive of each level node's mesh. Each level's error comes from the asset tool's
 * `NULL3D_lod_error`, which measured the level's own error, or its share of the screen's height
 * from `MSFT_screencoverage`. A measured error changes the picture by under a pixel at its switch,
 * so the level switches at once; a coverage given by hand keeps a fading band. A level that names
 * another material than the node's primitive draws with it. Levels whose meshes have other
 * primitives, or no errors, are left out, and so are levels that a mesh cannot take, with a note.
 */
function setFileLevels(
	base: readonly MeshGeometry[],
	levels: NodeLevels,
	data: GltfData,
	levelOf: (k: number) => MeshGeometry[],
	materials: FileMaterials,
	primitives: readonly PrimitiveData[],
): void {
	const count = base.length;
	if (levels.meshes.some((k) => (data.meshes[k] as MeshData).primitives.length !== count)) return;
	const lower = levels.meshes.map(levelOf);
	for (const [p, mesh] of base.entries()) {
		const measured = levels.errors !== undefined;
		const errors = levels.errors;
		const coverage = levels.coverage;
		if (!measured && !coverage) return;
		const own = primitives[p] as PrimitiveData | undefined;
		try {
			mesh.setLevels(
				lower.map((meshes, j) => {
					const level = (data.meshes[levels.meshes[j] as number] as MeshData).primitives[
						p
					] as PrimitiveData;
					const material = own && level.material !== own.material ? materials.of(level) : undefined;
					return {
						mesh: meshes[p] as MeshGeometry,
						...(measured
							? { error: (errors as number[])[j] as number, fade: false }
							: { coverage: (coverage as number[])[j] as number }),
						...(material && { material }),
					};
				}),
			);
		} catch (error) {
			data.notes.push(`the levels of detail of a mesh (${(error as Error).message})`);
			return;
		}
	}
}

/** A node's staged levels, and the meshes that draw them, one for each primitive of its mesh. */
interface StagedNode {
	/** The node's meshes, in the order of its mesh's primitives. */
	meshes: MeshGeometry[];
	/** The triangles that each mesh draws now, which the next stage replaces. */
	indices: (Uint16Array | Uint32Array | undefined)[];
	/** The error of the level that the file holds. */
	error: number;
	/** The stages, from the level after the file's own down to the finest. */
	stages: { url: string; bytes: number; error: number }[];
}

/** The magic number that a stage file starts with, as the word `N3DS` counted little-endian. */
const STAGE_MAGIC = 0x5344334e;
/** The version of the stage layout that the engine reads. */
const STAGE_VERSION = 1;
/** The kind of a stage that holds a level's triangles, one list for each of a mesh's primitives. */
const STAGE_LEVELS = 0;
/** The words of a stage file's header: its magic number, its version, its kind and its list count. */
const STAGE_HEADER = 4;

/**
 * The triangle lists that a stage file holds: one for each of the node's primitives, in the order
 * of its mesh's primitives. Exported for its tests. Each list names the number of bytes of its indices, so a mesh of at
 * most 65,535 vertices takes two. Undefined for a file that this engine does not read, which leaves
 * the model at the level it had.
 */
export function readStage(bytes: ArrayBuffer, count: number): Uint32Array[] | undefined {
	const size = bytes.byteLength;
	if (size < STAGE_HEADER * 4) return undefined;
	const view = new DataView(bytes);
	if (
		view.getUint32(0, true) !== STAGE_MAGIC ||
		view.getUint32(4, true) !== STAGE_VERSION ||
		view.getUint32(8, true) !== STAGE_LEVELS ||
		view.getUint32(12, true) !== count
	)
		return undefined;
	const lists: Uint32Array[] = [];
	let at = STAGE_HEADER * 4;
	for (let k = 0; k < count; k++) {
		if (at + 8 > size) return undefined;
		const length = view.getUint32(at, true);
		const width = view.getUint32(at + 4, true);
		at += 8;
		if (width !== 2 && width !== 4) return undefined;
		const bytesOf = Math.ceil((length * width) / 4) * 4;
		if (at + bytesOf > size) return undefined;
		const list = new Uint32Array(length);
		if (width === 2) list.set(new Uint16Array(bytes, at, length));
		else list.set(new Uint32Array(bytes, at, length));
		lists.push(list);
		at += bytesOf;
	}
	return at === size ? lists : undefined;
}

/**
 * Starts the downloads of a file's staged levels, each node's from the coarsest down, without
 * waiting for them: the sketch draws the level that the file holds while they arrive. `maxLevels`
 * stops each node's downloads after that many levels, the file's own counted first, so a page that
 * never shows the finest level saves its download.
 */
function startStages(
	context: GltfContext,
	prefab: Prefab,
	staged: Iterable<StagedNode>,
	made: MeshGeometry[],
	options: LoadGltfOptions,
	address: URL,
	call: string,
): void {
	const given = options.maxLevels ?? Number.POSITIVE_INFINITY;
	const maxLevels = given >= 1 ? Math.floor(given) : 1;
	for (const node of staged)
		void loadStages(context, prefab, node, made, maxLevels, address, call).catch((error) => {
			if (DEV)
				console.warn(
					`${call}() could not finish the levels of ${address}: ${error instanceof Error ? error.message : String(error)}`,
				);
		});
}

/**
 * The frames that the engine draws before a level that it never picked gives up its stage for now.
 * A camera that starts far away has time to show the level that the file draws: about two seconds
 * at 60 frames a second. A page that comes close waits at most that long for its finest stage.
 */
const STAGE_WARMUP_FRAMES = 120;

/**
 * The frames that the loader watches a stage it gave up for the camera coming close. A view that
 * picks the level the mesh draws shows that pick within the window, and the stage comes back.
 */
const STAGE_RETRY_FRAMES = 20;

/**
 * How long the loader waits between checks of the levels that the engine picked, and how long it
 * waits, with no watch running, before it looks again at a stage that it gave up. While it waits it
 * holds no watch, so a frame pays one check and nothing else.
 */
const STAGE_POLL_MS = 100;
const STAGE_RETRY_PAUSE_MS = 1500;

/**
 * True once a view has picked the levels that the node's meshes draw now, or false when `frames`
 * pass with no pick: a level that never draws cannot hand over to a finer one, so the stage would
 * buy nothing yet. A frame that draws no source of a mesh restarts that mesh's warm-up, so a page
 * that loads a model before it instantiates it keeps its stages. The watch that the check makes is
 * released before either answer, so the frames after it pay nothing.
 */
async function stagePicked(
	context: GltfContext,
	prefab: Prefab,
	meshes: readonly MeshGeometry[],
	frames: number,
): Promise<boolean> {
	const { glue } = context.core;
	const ids = meshes.filter((mesh) => mesh.live).map((mesh) => mesh.id);
	if (ids.length === 0) return false;
	for (const id of ids) glue.watchStageLevels(id);
	try {
		for (;;) {
			if (!prefab.live) return false;
			let drawn = 0;
			for (const id of ids) {
				// Bit 0 is the level that the mesh draws now: the pending stage would replace it.
				if ((glue.stageLevelPicks(id) & 1) !== 0) return true;
				drawn = Math.max(drawn, glue.stageFrames(id));
			}
			if (drawn >= frames) return false;
			await new Promise((resolve) => setTimeout(resolve, STAGE_POLL_MS));
		}
	} finally {
		for (const id of ids) glue.unwatchStageLevels(id);
	}
}

/**
 * True once a view picks the level that the node's meshes draw now, so the stage on hold would
 * replace a level on screen: false only when the model or its meshes have gone. A stage that the
 * warm-up passes without a pick is not gone for good: the loader stops watching it and looks again
 * after a pause, so a camera that starts far away and comes close later still gets the level it
 * then needs.
 */
async function stageWanted(
	context: GltfContext,
	prefab: Prefab,
	meshes: readonly MeshGeometry[],
): Promise<boolean> {
	if (await stagePicked(context, prefab, meshes, STAGE_WARMUP_FRAMES)) return true;
	for (;;) {
		if (!prefab.live || !meshes.some((mesh) => mesh.live)) return false;
		await new Promise((resolve) => setTimeout(resolve, STAGE_RETRY_PAUSE_MS));
		if (!prefab.live || !meshes.some((mesh) => mesh.live)) return false;
		if (await stagePicked(context, prefab, meshes, STAGE_RETRY_FRAMES)) return true;
	}
}

/**
 * Downloads one node's staged levels, coarsest first, and gives the node's meshes each level as it
 * arrives: the level that the mesh drew becomes a level of the mesh, and the arriving one takes its
 * place, so the objects that already draw the mesh refine without a new object. The first stage
 * always arrives, and each later one waits until the level loaded now has drawn. A level that never
 * draws holds its stage back while it can, and a camera that later asks for it brings it back. A
 * mesh that cannot take another triangle list keeps the level it has, and its stages stop.
 */
async function loadStages(
	context: GltfContext,
	prefab: Prefab,
	node: StagedNode,
	made: MeshGeometry[],
	maxLevels: number,
	address: URL,
	call: string,
): Promise<void> {
	const levels = node.meshes.map((): MeshLevel[] => []);
	const indices = node.indices.slice();
	// Each arriving stage adds the level that the mesh drew until then, so the level's own error
	// is the one that the file or the stage before it gave.
	let drawn = node.error;
	let loaded = 1;
	for (const [index, stage] of node.stages.entries()) {
		if (loaded >= maxLevels) return;
		// The stage after the file's own level always arrives: it is what the file draws until it
		// does. Each finer stage waits for the level loaded now to be picked, and a stage that the
		// camera ignores waits again rather than dropping out of the chain.
		if (index > 0 && !(await stageWanted(context, prefab, node.meshes))) return;
		const blob = await context.download(new URL(stage.url, address), call);
		const bytes = await blob.arrayBuffer();
		if (!prefab.live) return;
		const lists = readStage(bytes, node.meshes.length);
		if (!lists) {
			if (DEV)
				console.warn(
					`${call}() left out a level of ${address}: the file at ${stage.url} does not hold the triangles of ${node.meshes.length} primitives.`,
				);
			return;
		}
		loaded += 1;
		let taken = false;
		for (const [k, mesh] of node.meshes.entries()) {
			const current = indices[k];
			const list = lists[k] as Uint32Array;
			if (current === undefined) continue;
			const level = context.geometry.fromLevel(mesh, current);
			if (!level || !mesh.replaceTriangles(list)) {
				level?.destroy();
				continue;
			}
			made.push(level);
			levels[k]?.unshift({ mesh: level, error: drawn, fade: false });
			try {
				mesh.setLevels(levels[k] ?? []);
			} catch (error) {
				if (DEV)
					console.warn(
						`${call}() left out a level of ${address}: ${error instanceof Error ? error.message : String(error)}`,
					);
				return;
			}
			indices[k] = list;
			taken = true;
		}
		// No mesh of the node took the list, so no finer stage would either.
		if (!taken) return;
		drawn = stage.error;
	}
}

/** The prefab of a parsed file, once its textures and materials exist. */
async function buildPrefab(
	context: GltfContext,
	data: GltfData,
	textures: readonly (Texture | undefined)[],
	materials: FileMaterials,
	made: Made,
	extensionParts: ReadonlyMap<number, HandlerPart[]>,
	address: URL,
	call: string,
	staged: Map<number, StagedNode>,
): Promise<Prefab> {
	// Only the meshes that nodes draw: joints move copies of some of the file's meshes.
	const meshes: (MeshGeometry[] | undefined)[] = [];
	const meshOf = (k: number) => {
		meshes[k] ??= makeMeshes(context, data.meshes[k] as MeshData, made.meshes, address, call);
		return meshes[k];
	};
	/**
	 * A level's meshes built over its base's vertices, where the file gives the level the base's
	 * own accessors: the level then costs indices alone. Each base keeps its own copy, since a
	 * level belongs to the mesh whose vertices it draws.
	 */
	const levels = new Map<string, MeshGeometry[]>();
	const levelOf = (baseIndex: number, k: number) => {
		const key = `${baseIndex} ${k}`;
		let lower = levels.get(key);
		if (!lower) {
			lower = makeMeshes(context, data.meshes[k] as MeshData, made.meshes, address, call, {
				meshes: meshOf(baseIndex),
				primitives: (data.meshes[baseIndex] as MeshData).primitives,
			});
			levels.set(key, lower);
		}
		return lower;
	};
	const lights = data.lights.map(lightTemplate);
	/** Each light map that the file's `NEEDLE_lightmaps` registers, or undefined where it failed. */
	const lightMaps = data.lightMaps.map((use) => (use < 0 ? undefined : textures[use]));
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
			levelBias: 1,
			root: true,
		},
	];
	const instancing: InstancingTemplate[] = [];
	/** Each file node's template node, which its children go under, or -1 for a joint. */
	const placed: number[] = [];
	const parents = new Set(data.nodes.map((n) => n.parent));
	/**
	 * Adds a template node, which a copy makes an object of. A node that the file hides draws
	 * nothing until a clip shows it.
	 */
	const node = (
		fields: Partial<TemplateNode> &
			Pick<TemplateNode, 'name' | 'parent' | 'transform'> & { visible?: boolean },
	) => {
		const { visible = true, ...rest } = fields;
		return (
			template.push({
				flags: FLAG_VISIBLE,
				layers: LAYERS_DEFAULT,
				renderOrder: 0,
				levelBias: 1,
				...rest,
				...(visible ? {} : { flags: 0 }),
			}) - 1
		);
	};
	/** The template node that holds each file light, by the light's index. */
	const lightNode: number[] = [];
	for (const [index, n] of data.nodes.entries()) {
		const parent = n.parent < 0 ? 0 : (placed[n.parent] as number);
		const visible = n.visible !== false;
		const mesh = n.mesh < 0 ? undefined : (data.meshes[n.mesh] as MeshData);
		const made = n.mesh < 0 ? [] : meshOf(n.mesh);
		if (n.levels)
			setFileLevels(
				made,
				n.levels,
				data,
				(k) => levelOf(n.mesh, k),
				materials,
				mesh?.primitives ?? [],
			);
		// A staged mesh draws the level that the file holds, and takes the finer ones as they
		// download. Only a mesh whose primitives all name their triangles can take another list.
		// One chain per mesh, whichever nodes draw it: a mesh that two nodes draw takes each stage
		// once, so the two copies refine together.
		if (
			n.stages &&
			made.length > 0 &&
			!staged.has(n.mesh) &&
			(n.mesh < 0 || data.meshes[n.mesh]?.primitives.every((p) => p.indices !== undefined))
		)
			staged.set(n.mesh, {
				meshes: made,
				indices: made.map((_, k) => data.meshes[n.mesh]?.primitives[k]?.indices),
				error: n.stages.error,
				stages: n.stages.levels,
			});
		const lightMap = nodeLightMap(n.lightMap, lightMaps);
		const parts = [
			...(mesh?.primitives ?? []).map((p, k) => ({
				mesh: made[k] as MeshGeometry,
				material: materials.of(p, lightMap),
				...morphOf(mesh as MeshData, p, n),
				// The asset tool marks the primitives that block the view, as `setOccluder` does.
				...(p.occluder && { flags: FLAG_VISIBLE | FLAG_OCCLUDER }),
			})),
			...(extensionParts.get(index) ?? []),
		];
		const light = n.light < 0 ? undefined : lights[n.light];
		if (n.skinned) {
			// Joints move the mesh in the space of the copy's group, where the parser boxed it.
			parts.forEach((part, k) => {
				const rest = mesh?.primitives[k]?.rest;
				node({
					name: n.name,
					parent: 0,
					transform: IDENTITY,
					visible,
					...part,
					skinned: true,
					rest,
				});
			});
			const isObject = (n.joint ?? -1) < 0 && parents.has(index);
			placed.push(isObject ? node({ name: n.name, parent, transform: n.transform, visible }) : -1);
			continue;
		}
		if ((n.joint ?? -1) >= 0 && parts.length === 0 && !light) {
			// A joint is no object, and its children went under the copy's group.
			placed.push(-1);
			continue;
		}
		if (n.instancing) {
			const at = node({ name: n.name, parent, transform: n.transform, visible });
			placed.push(at);
			instancing.push({
				node: at,
				...n.instancing,
				parts: parts.map((part) => ({ ...part, matrix: IDENTITY_PART })),
			});
			if (light)
				lightNode[n.light] = node({
					name: n.name,
					parent: at,
					transform: IDENTITY,
					light,
					visible,
				});
			continue;
		}
		if (parts.length === 1 && !light) {
			const [part] = parts as [(typeof parts)[number]];
			placed.push(node({ name: n.name, parent, transform: n.transform, visible, ...part }));
			continue;
		}
		if (parts.length === 0 && light) {
			const at = node({ name: n.name, parent, transform: n.transform, light, visible });
			lightNode[n.light] = at;
			placed.push(at);
			continue;
		}
		const at = node({ name: n.name, parent, transform: n.transform, visible });
		placed.push(at);
		for (const part of parts)
			node({ name: n.name, parent: at, transform: IDENTITY, visible, ...part });
		if (light)
			lightNode[n.light] = node({ name: n.name, parent: at, transform: IDENTITY, light, visible });
	}
	const properties = propertyAnimation(data, materials, placed, lightNode, rig, data.notes);
	const { parts, bounds } = partsOf(template, data, meshes, instancing);
	if (DEV && data.notes.length > 0)
		console.warn(`${call}() left out parts of ${address}: ${data.notes.join('; ')}.`);
	if (DEV && data.draco)
		console.warn(
			`${call}() loaded ${address}, whose meshes use Draco compression. Draco's decoder adds about 60 KB to the page's download, and decodes slower than meshopt. Convert the file to meshopt with \`bunx @null3d/cli assets optimize\`.`,
		);
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
		properties,
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
	if (!animation) return undefined;
	const movesProperties = animation.clips.some((clip) => (clip.properties?.length ?? 0) > 0);
	if (animation.joints.length === 0 && !movesProperties) return undefined;
	try {
		// A file that moves only properties still takes a skeleton, which holds its clips: one
		// joint at the origin, which moves no vertex.
		const rig = animation.joints.length > 0 ? animation : { ...animation, joints: [REST_JOINT] };
		return await loadAnimationRig(context.scene, rig);
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

/** The joint of a model whose clips move only properties: it rests at the origin. */
const REST_JOINT: RigJoint = {
	name: '',
	parent: -1,
	translation: [0, 0, 0],
	rotation: [0, 0, 0, 1],
	scale: [1, 1, 1],
	inverseBind: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
};

/**
 * The engine's meshes of a glTF mesh, one for each primitive, with the stored tree and the blocker
 * that the asset tool gave each primitive. Each mesh also goes into `out` as it is made. A level
 * whose primitive shares its base primitive's vertex accessors draws the base mesh's vertices from
 * its own indices, so it costs the GPU indices alone; any other level copies its arrays.
 */
function makeMeshes(
	context: GltfContext,
	mesh: MeshData,
	out: MeshGeometry[],
	address: URL,
	call: string,
	base?: { meshes: readonly MeshGeometry[]; primitives: readonly PrimitiveData[] },
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
		let made: MeshGeometry | undefined;
		try {
			if (base?.meshes[k] !== undefined && sharesVertices(p, base.primitives[k]))
				made = context.geometry.fromLevel(base.meshes[k] as MeshGeometry, p.indices ?? []);
			made ??= context.geometry.fromArrays(arrays);
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
		if (p.patches && storePatches(context.core, made.id, p.patches, call) !== 1 && DEV)
			console.warn(
				`${call}() found a tree of patches in ${address} that does not fit primitive ${k} of mesh "${mesh.name}", so the mesh draws whole. Optimize the file again.`,
			);
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
	core.view(Uint8Array, at, bytes.byteLength).set(bytes);
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
 * Gives a mesh the tree of cluster patches that the file stores: the patches' spheres and records,
 * then their indices, at the address that the staging words give. Returns 1 when the mesh takes
 * the tree, and 0 or the code of the rule that refused it otherwise (see `setMeshPatches`).
 */
function storePatches(core: CoreMemory, mesh: number, patches: PatchesData, call: string): number {
	const { bounds, words, indices, root } = patches;
	const records = words.length / 4;
	const at = core.checkGrowth(core.glue.meshArrays(records * 8 + indices.length), call);
	// Eight words a patch: its sphere's four floats, then its record's four integers.
	const staging = core.u32(at, records * 8);
	const floats = new Float32Array(staging.buffer, staging.byteOffset, records * 8);
	for (let k = 0; k < records; k++) {
		floats.set(bounds.subarray(k * 4, k * 4 + 4), k * 8);
		staging.set(words.subarray(k * 4, k * 4 + 4), k * 8 + 4);
	}
	core.u32(at + records * 32, indices.length).set(indices);
	return core.glue.setMeshPatches(mesh, records, indices.length, root);
}

/**
 * The light map that a node's Needle `MeshRenderer` names, with the texture that the file's
 * `NEEDLE_lightmaps` registers at its index and the scale and offset of its coordinates. `key`
 * names the assignment, so that nodes which place the same map alike share a material.
 */
interface NodeLightMap {
	texture: Texture;
	scale: readonly [number, number];
	offset: readonly [number, number];
	key: string;
}

/**
 * The material options of a node's light map: its texture, the scale and offset that place the
 * bake on the mesh, and Needle's RGBM decode. Needle's offset counts rows from the top, so the
 * vertical one flips here.
 */
function lightMapOptions(lightMap: NodeLightMap | undefined): StandardOptions {
	if (!lightMap) return {};
	return {
		lightMap: lightMap.texture,
		lightMapRepeat: lightMap.scale,
		lightMapOffset: [lightMap.offset[0], 1 - lightMap.scale[1] - lightMap.offset[1]],
		lightMapDecode: 'rgbm',
	};
}

/** The light map of a node, or undefined when the node has none or its texture did not load. */
function nodeLightMap(
	held: NodeData['lightMap'],
	maps: readonly (Texture | undefined)[],
): NodeLightMap | undefined {
	if (!held) return undefined;
	const texture = maps[held.index];
	if (!texture) return undefined;
	return {
		texture,
		scale: held.scale,
		offset: held.offset,
		key: `${held.index} ${held.scale.join(',')} ${held.offset.join(',')}`,
	};
}

/**
 * The engine's materials of a file: one for each of its materials, and one for each other way a
 * primitive draws it, as three.js's GLTFLoader makes them. A primitive with vertex colors turns
 * them on, one without normals shades flat, and one without tangents turns its normal map's
 * green channel over, as three.js does where it finds tangents from screen derivatives.
 */
class FileMaterials {
	private readonly made = new Map<string, Material>();
	/** The materials that the extension handlers made, which the model frees too. */
	private readonly extra: Material[] = [];

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

	/**
	 * Every material that draws the file's material `k`: the material itself, and each variant of
	 * it that a primitive asked for. A property animation writes them all.
	 */
	variants(k: number): Material[] {
		const out: Material[] = [];
		for (const [key, material] of this.made) if (key.startsWith(`${k} `)) out.push(material);
		return out;
	}

	/** Every material made so far: the file's, the other ways that primitives draw them, and the
	 * handlers' materials. */
	all(): Material[] {
		return [...this.made.values(), ...this.extra];
	}

	/** Takes a material that an extension handler made, so the model frees it once. */
	own(material: Material): void {
		if (this.extra.includes(material) || [...this.made.values()].includes(material)) return;
		this.extra.push(material);
	}

	/** Destroys every material made so far, for a load that fails. */
	destroy(): void {
		for (const material of new Set([...this.made.values(), ...this.extra])) material.destroy();
		this.made.clear();
		this.extra.length = 0;
	}

	/** The material that draws a primitive, with the light map that the primitive's node names. */
	of(p: PrimitiveData, lightMap?: NodeLightMap): Material {
		return this.variant(
			p.material,
			p.colors !== undefined,
			!p.normals,
			p.tangents !== undefined,
			lightMap,
		);
	}

	/**
	 * The material that the file gives a primitive which an extension handler reads, or undefined
	 * when it gives none. The handler may draw with it or with a material of its own.
	 */
	ofExtension(material: number): Material | undefined {
		return material < 0 ? undefined : this.variant(material, false, false, true);
	}

	private variant(
		k: number,
		vertexColors: boolean,
		flat: boolean,
		tangents: boolean,
		lightMap?: NodeLightMap,
	): Material {
		const key = `${k} ${vertexColors} ${flat} ${tangents}${lightMap ? ` ${lightMap.key}` : ''}`;
		let material = this.made.get(key);
		if (!material) {
			material = this.create(this.data.materials[k], vertexColors, flat, tangents, lightMap);
			this.made.set(key, material);
		}
		return material;
	}

	private create(
		m: MaterialData | undefined,
		vertexColors: boolean,
		flatShading: boolean,
		tangents: boolean,
		lightMap?: NodeLightMap,
	): Material {
		const { materials } = this.context;
		const baked = lightMapOptions(lightMap);
		if (!m)
			return materials.standard({
				metalness: 1,
				roughness: 1,
				vertexColors,
				flatShading,
				...baked,
			});
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
			diffuseTransmissionMap: map(m.maps.diffuseTransmissionMap),
			diffuseTransmissionColorMap: map(m.maps.diffuseTransmissionColorMap),
			transmissionMap: map(m.maps.transmissionMap),
			thicknessMap: map(m.maps.thicknessMap),
		};
		const volume = m.transmission ?? m.diffuseTransmission;
		if (volume) {
			options.thickness = volume.thickness;
			options.attenuationColor = volume.attenuationColor;
			options.attenuationDistance = volume.attenuationDistance;
		}
		if (m.transmission) options.transmission = m.transmission.factor;
		if (m.diffuseTransmission) {
			options.diffuseTransmission = m.diffuseTransmission.factor;
			options.diffuseTransmissionColor = m.diffuseTransmission.color;
		}
		if (m.scatter) {
			options.subsurfaceRadius = m.scatter.radius;
			options.subsurfaceColor = m.scatter.color;
		}
		const layers = m.layers;
		Object.assign(options, baked);
		if (layers) {
			const scale = layers.clearcoatNormalScale;
			options.clearcoat = layers.clearcoat;
			options.clearcoatRoughness = layers.clearcoatRoughness;
			options.clearcoatNormalScale = [scale, tangents ? scale : -scale];
			options.sheenColor = layers.sheenColor;
			options.sheenRoughness = layers.sheenRoughness;
			// A material pays nothing for an extension that its file does not give.
			if (layers.iridescence !== undefined) options.iridescence = layers.iridescence;
			if (layers.iridescenceIor !== undefined) options.iridescenceIor = layers.iridescenceIor;
			if (layers.iridescenceThicknessRange !== undefined)
				options.iridescenceThicknessRange = layers.iridescenceThicknessRange;
			if (layers.anisotropy !== undefined) options.anisotropy = layers.anisotropy;
			if (layers.anisotropyRotation !== undefined)
				options.anisotropyRotation = layers.anisotropyRotation;
			options.clearcoatMap = map(m.maps.clearcoatMap);
			options.clearcoatRoughnessMap = map(m.maps.clearcoatRoughnessMap);
			options.clearcoatNormalMap = map(m.maps.clearcoatNormalMap);
			options.sheenColorMap = map(m.maps.sheenColorMap);
			options.sheenRoughnessMap = map(m.maps.sheenRoughnessMap);
			options.iridescenceMap = map(m.maps.iridescenceMap);
			options.iridescenceThicknessMap = map(m.maps.iridescenceThicknessMap);
			options.anisotropyMap = map(m.maps.anisotropyMap);
		}
		return materials.standard(options);
	}
}

/** The properties of a light that a track may move, by the name that a pointer gives them. */
const LIGHT_PROPERTIES: ReadonlyMap<string, number> = new Map([
	['intensity', PROPERTY_LIGHT_INTENSITY],
	['color', PROPERTY_LIGHT_COLOR],
	['range', PROPERTY_LIGHT_RANGE],
	['angle', PROPERTY_LIGHT_ANGLE],
]);

/**
 * The properties that a model's clips move, as the prefab's copies play them: one binding for each
 * property, with the value that the file gave it, and the tracks of each clip by its id in the
 * core. Returns undefined when no clip moves a property, and notes the tracks that name a target
 * the copy does not have.
 */
function propertyAnimation(
	data: GltfData,
	materials: FileMaterials,
	placed: readonly number[],
	lightNode: readonly number[],
	rig: AnimationRig | undefined,
	notes: string[],
): PropertyAnimationData | undefined {
	if (!rig || !data.animation) return undefined;
	const bindings: PropertyBinding[] = [];
	const targets: (Material[] | { node: number })[] = [];
	const keys: string[] = [];
	const known = new Map<string, number>();
	const clips: (PropertyTrack[] | undefined)[] = [];
	let found = false;
	for (const clip of data.animation.clips) {
		const id = rig.clips.get(clip.name);
		if (id === undefined) continue;
		const tracks: PropertyTrack[] = [];
		// A material keeps one texture transform for every map, so a clip that moves two of them
		// plays the first and notes the other rather than mixing the two into one value.
		const played = new Set<number>();
		for (const track of clip.properties ?? []) {
			const { target, components } = track;
			const key = `${target.kind} ${target.index} ${target.value}`;
			let binding = known.get(key);
			if (binding === undefined) {
				const base = propertyBase(target, data);
				const where = propertyTarget(target, materials, placed, lightNode);
				if (!base || !where) {
					notes.push(
						`the clip "${clip.name}" moves ${target.kind} ${target.index}'s ${target.value}, which this copy does not have`,
					);
					continue;
				}
				binding = bindings.length;
				const what =
					target.kind === 'material'
						? PROPERTY_MATERIAL
						: target.kind === 'node'
							? PROPERTY_VISIBLE
							: (LIGHT_PROPERTIES.get(target.value) ?? PROPERTY_LIGHT_INTENSITY);
				bindings.push({
					what,
					name: target.kind === 'material' ? target.value : '',
					components,
					base,
				});
				targets.push(where);
				// The key names the property as a file's pointer does, such as "materials/0/color".
				const name = target.kind === 'material' ? (target.key ?? target.value) : target.value;
				keys.push(`${target.kind}s/${target.index}/${name}`);
				known.set(key, binding);
			}
			if (played.has(binding)) {
				notes.push(
					`the clip "${clip.name}" moves two transforms of ${target.kind} ${target.index}, and the engine keeps one for every map, so it plays the first`,
				);
				continue;
			}
			played.add(binding);
			tracks.push({
				binding,
				interpolation: track.interpolation ?? 'linear',
				times: track.times as Float32Array,
				values: track.values as Float32Array,
			});
		}
		if (tracks.length === 0) continue;
		found = true;
		clips[id - 1] = tracks;
	}
	return found ? { bindings, targets, clips, keys } : undefined;
}

/** Where a property binding's target lies in a copy: the materials that draw it, or its node. */
function propertyTarget(
	target: RigPropertyTarget,
	materials: FileMaterials,
	placed: readonly number[],
	lightNode: readonly number[],
): Material[] | { node: number } | undefined {
	if (target.kind === 'material') {
		const variants = materials.variants(target.index);
		return variants.length > 0 ? variants : undefined;
	}
	const node = target.kind === 'light' ? lightNode[target.index] : placed[target.index];
	return node === undefined || node < 0 ? undefined : { node };
}

/**
 * The value that the file gave a property, which a clip at less than full weight mixes with: the
 * value that the engine made the material, the light or the node with.
 */
function propertyBase(target: RigPropertyTarget, data: GltfData): Float32Array | undefined {
	if (target.kind === 'material') {
		const m = data.materials[target.index];
		if (!m) return undefined;
		const layers = m.layers;
		const one = (value: number | undefined) => new Float32Array([value ?? 0]);
		switch (target.value) {
			case 'color':
				return Float32Array.from(m.color);
			case 'opacity':
				return one(m.opacity);
			case 'metalness':
				return one(m.metalness);
			case 'roughness':
				return one(m.roughness);
			case 'emissive':
				return Float32Array.from(m.emissive);
			case 'emissiveIntensity':
				return one(m.emissiveIntensity);
			case 'alphaCutoff':
				// The loader clamps the cutoff, so the material holds the clamped value.
				return one(Math.min(m.alphaCutoff, 1));
			case 'aoMapIntensity':
				return one(m.aoMapIntensity);
			case 'specularIntensity':
				return one(m.specularIntensity);
			case 'specularColor':
				return Float32Array.from(m.specularColor);
			case 'transmission':
				return one(m.transmission?.factor);
			case 'thickness':
				return one(m.transmission?.thickness ?? m.diffuseTransmission?.thickness);
			case 'clearcoat':
				return one(layers?.clearcoat);
			case 'clearcoatRoughness':
				return one(layers?.clearcoatRoughness);
			case 'sheenColor':
				return layers ? Float32Array.from(layers.sheenColor) : new Float32Array(3);
			case 'sheenRoughness':
				return one(layers?.sheenRoughness);
			case 'iridescence':
				return one(layers?.iridescence);
			case 'iridescenceIor':
				return one(layers?.iridescenceIor);
			case 'anisotropy':
				return one(layers?.anisotropy);
			case 'anisotropyRotation':
				return one(layers?.anisotropyRotation);
			case 'uvOffset':
				return Float32Array.from(m.uvTransform?.offset ?? [0, 0]);
			case 'uvScale':
				return Float32Array.from(m.uvTransform?.repeat ?? [1, 1]);
		}
		return undefined;
	}
	if (target.kind === 'light') {
		const light = data.lights[target.index];
		if (!light) return undefined;
		if (target.value === 'color') return Float32Array.from(light.color);
		// The engine's range covers the file's light when the file gives none, so it comes from the
		// template that the copy makes its light from.
		const values = lightTemplate(light).values;
		const code =
			target.value === 'intensity'
				? LIGHT_VALUE_INTENSITY
				: target.value === 'range'
					? LIGHT_VALUE_RANGE
					: LIGHT_VALUE_ANGLE;
		for (const [which, value] of values) if (which === code) return new Float32Array([value]);
		return undefined;
	}
	const node = data.nodes[target.index];
	return node ? new Float32Array([node.visible === false ? 0 : 1]) : undefined;
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
 * the bounds of every mesh in that space, the instances of instancing nodes included. A mesh that
 * joints move has its box in that space already, and draws in a batch where it lies at rest.
 */
function partsOf(
	template: readonly TemplateNode[],
	data: GltfData,
	meshes: readonly (MeshGeometry[] | undefined)[],
	instancing: readonly InstancingTemplate[],
): { parts: PartTemplate[]; bounds: ReturnType<typeof boundsOf> } {
	const worlds: Float64Array[] = [];
	const primitives = new Map<MeshGeometry, PrimitiveData>();
	data.meshes.forEach((mesh, k) => {
		const made = meshes[k];
		if (!made) return;
		mesh.primitives.forEach((p, j) => {
			primitives.set(made[j] as MeshGeometry, p);
		});
	});
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	const grow = (m: Float64Array, mesh: MeshGeometry) => {
		const p = primitives.get(mesh);
		if (p) growBox(m, p.min, p.max, min, max);
		else {
			// A mesh that an extension handler made gives no box of its own, so its radius around
			// the node's origin holds it.
			const r = mesh.radius;
			growBox(m, [-r, -r, -r], [r, r, r], min, max);
		}
	};
	const parts: PartTemplate[] = [];
	template.forEach((node, k) => {
		const local = affineOf(node.transform);
		worlds[k] =
			node.parent < 0 ? local : multiplyAffine(worlds[node.parent] as Float64Array, local);
		const world = worlds[k] as Float64Array;
		if (node.mesh && node.material) {
			const { rest } = node;
			parts.push({
				mesh: node.mesh,
				material: node.material,
				matrix: Float32Array.from(rest?.matrix ?? world),
				...(rest?.exact === false && { bindPose: true }),
			});
			grow(world, node.mesh);
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
			for (const part of spec.parts) grow(placed, part.mesh);
		}
	}
	const empty = min[0] === Infinity;
	return { parts, bounds: empty ? boundsOf([0, 0, 0], [0, 0, 0]) : boundsOf(min, max) };
}
