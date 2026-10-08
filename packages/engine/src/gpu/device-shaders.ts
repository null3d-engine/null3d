// The engine's shaders that load by device, as the thread that draws holds them. A page loads the
// one module of its device's fixed permutation bits. A pipeline can still ask for a variant with
// other fixed bits: when a sketch turns on an effect that needs HDR color on the 8-bit path, the
// core switches to HDR color, and its pipelines then lack the tone mapping bit. The set then loads
// the module of those bits, once, and adds its builds to the variants that the backends already
// hold, so their templates find them. The builds of a feature that loads on first use, such as
// sprites or bloom, sit in modules of the feature's own: the set loads one in the same way the
// first time a pipeline asks for one of the feature's builds. Until a module arrives, the pipeline
// waits as a custom material's pipeline waits for its shader. Before the first frame, the frame
// waits with it. After it, frames go on, and what the pipeline draws appears once it is built.
//
// A custom material's builds load the same way, from files that the null3D Vite plugin writes: one
// for each GPU path and each value of the fixed bits. The set starts to download the device's file
// as soon as the material's shader reaches the thread that draws, and adds the file's builds to the
// shader's variants, which start empty. A download that fails stops the drawing: E1406 for the
// engine's own file, E1424 for a custom material's.

import { reasonOf } from '../errors/message';
import { PERMUTATION_DRAW_INDEX, PERMUTATION_HALF, PERMUTATION_TONE_MAP } from '../generated/gpu';
import {
	type DeviceShaders,
	type FirstUseShaders,
	firstUseFeature,
	type ShaderVariant,
	type ShaderVariants,
} from '../generated/shaders';
import type { CustomShader, ShaderFiles } from '../shared/images';
import { variantFor } from './variants';

/** The permutation bits that a device fixes and that a pipeline's word can hold. */
const PIPELINE_DEVICE_BITS = PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP;

/**
 * Features that move the 8-bit path to HDR color, whose pipelines then ask for builds without the
 * tone mapping bit. Preloading one on that path also loads the start's builds without the bit.
 */
const HDR_FEATURES: ReadonlySet<string> = new Set(['bloom']);

/**
 * Loads a device module: the start's module of the fixed bits `bits` when `feature` is undefined,
 * or else the module of that feature, which loads on first use, for a device with those bits.
 */
export type DeviceModuleLoader = (
	bits: number,
	feature: string | undefined,
) => Promise<FirstUseShaders>;

/** Loads a file of custom materials' builds: each material's builds, in the file's order. */
export type MaterialFileLoader = (url: string) => Promise<readonly ShaderVariants[]>;

/** Imports a file of custom materials' builds by its address. */
const importMaterialFile: MaterialFileLoader = (url) =>
	import(/* @vite-ignore */ url).then(
		(module: { SHADERS: readonly ShaderVariants[] }) => module.SHADERS,
	);

/** The device shaders that a backend reads, which grow by another module when a pipeline needs it. */
export class DeviceShaderSet {
	/**
	 * Each module that this set loaded or is loading, by its key: its feature and fixed bits. Each
	 * resolves to the module's builds, or to nothing when it failed to load.
	 */
	private readonly modules = new Map<string, Promise<FirstUseShaders | undefined>>();
	/** The key of each module that a preload asked for, with its feature. */
	private readonly preloaded = new Map<string, string>();
	/** The modules that a preload asked for and that arrived, with their features. */
	private readonly arrived: [string, FirstUseShaders][] = [];
	/** Hears each module that a preload asked for, once it arrives. */
	private listener: ((feature: string, module: FirstUseShaders) => void) | undefined;
	/** The key of each module whose builds the set holds, or that failed to load. */
	private readonly settled = new Set<string>();
	/** What failed to download, and why, by the key of each module or file that failed. */
	private readonly failures = new Map<string, string>();
	/** The name of each shader whose variants the backends hold, by those variants. */
	private readonly names = new Map<ShaderVariants, string>();
	/** The files of each custom material's builds, by the variants that the builds go into. */
	private readonly files = new WeakMap<ShaderVariants, ShaderFiles>();

	/**
	 * `shaders` are the builds of the start's module with the fixed bits `bits`, which the backends
	 * hold, with an entry for every shader that loads by device. `load` loads another module, and
	 * `loadFile` a file of custom materials' builds.
	 */
	constructor(
		readonly shaders: DeviceShaders,
		private readonly bits: number,
		private readonly load: DeviceModuleLoader,
		private readonly loadFile: MaterialFileLoader = importMaterialFile,
	) {
		const key = moduleKey(undefined, bits);
		this.modules.set(key, Promise.resolve(undefined));
		this.settled.add(key);
		for (const [name, variants] of Object.entries(shaders)) this.names.set(variants, name);
	}

	/**
	 * True when `variants` hold a build for `permutation` with output for `target`, or when the
	 * module or custom material's file that would hold it has loaded, so the backend can build the
	 * pipeline or report its error. Otherwise it starts to load that module or file, once, and
	 * returns false until it has. When that download failed, it throws the reason with its code:
	 * E1406 for the engine's module and E1424 for a custom material's file. The page makes it an
	 * engine error, so this thread does not load the error table.
	 */
	ready(variants: ShaderVariants, permutation: number, target: 'wgsl' | 'glsl'): boolean {
		if (variantFor(variants, permutation, target)) return true;
		const fixed = permutation & PIPELINE_DEVICE_BITS;
		const files = this.files.get(variants);
		let key: string;
		if (files) {
			const url = files[target][fixed];
			// A custom material without a file for these bits has no build for them.
			if (url === undefined) return true;
			key = this.loadMaterialFile(variants, url, files.index);
		} else {
			const name = this.names.get(variants);
			const feature = name === undefined ? undefined : firstUseFeature(name, permutation);
			key = this.loadModule(feature, fixed | (this.bits & PERMUTATION_HALF));
		}
		const failure = this.failures.get(key);
		if (failure !== undefined) throw new Error(failure);
		return this.settled.has(key);
	}

	/**
	 * Notes the files of a custom material's builds, when its shader has them, and starts to
	 * download the file of this device's fixed bits for `target`, once. The file's builds then go
	 * into the shader's variants. A pipeline with other fixed bits loads its file when it asks.
	 */
	custom(shader: CustomShader, target: 'wgsl' | 'glsl'): void {
		const files = shader.files;
		if (!files || this.files.has(shader.variants)) return;
		this.files.set(shader.variants, files);
		const url = files[target][this.bits & PIPELINE_DEVICE_BITS];
		if (url !== undefined) this.loadMaterialFile(shader.variants, url, files.index);
	}

	/**
	 * Loads the modules of `features`, which load on first use, for this device's fixed bits, so
	 * that their pipelines need not wait for a download. A module that the set loaded or is loading
	 * loads only once. Resolves once each module has arrived or failed to.
	 */
	preload(features: Iterable<string>): Promise<void> {
		const bits = this.bits & (PIPELINE_DEVICE_BITS | PERMUTATION_HALF);
		const keys: string[] = [];
		const ask = (feature: string, at: number) => {
			const key = this.loadModule(feature, at);
			keys.push(key);
			if (this.preloaded.has(key)) return;
			this.preloaded.set(key, feature);
			void this.modules.get(key)?.then((module) => {
				if (!module) return;
				this.arrived.push([feature, module]);
				this.listener?.(feature, module);
			});
		};
		for (const feature of features) {
			ask(feature, bits);
			if (HDR_FEATURES.has(feature) && bits & PERMUTATION_TONE_MAP) {
				const hdr = bits & ~PERMUTATION_TONE_MAP;
				keys.push(this.loadModule(undefined, hdr));
				ask(feature, hdr);
			}
		}
		return Promise.all(keys.map((key) => this.modules.get(key))).then(() => undefined);
	}

	/**
	 * Hands each module that a preload asked for to `listener` once it arrives: those that arrived
	 * already, at once. A backend starts to build their shaders, so the feature's first objects
	 * wait less.
	 */
	onPreloaded(listener: (feature: string, module: FirstUseShaders) => void): void {
		this.listener = listener;
		for (const [feature, module] of this.arrived) listener(feature, module);
	}

	/** Starts to load the module of `feature` and `bits`, once, and returns its key. */
	private loadModule(feature: string | undefined, bits: number): string {
		return this.download(
			moduleKey(feature, bits),
			"E1406: the engine's shaders that a pipeline needs",
			() =>
				this.load(bits, feature).then((more) => {
					this.add(more);
					return more;
				}),
		);
	}

	/**
	 * Starts to load the file at `url` of a custom material's builds, once, adds the builds at
	 * `index` in it to `variants`, and returns its key.
	 */
	private loadMaterialFile(variants: ShaderVariants, url: string, index: number): string {
		return this.download(
			`${url}#${index}`,
			`E1424: the shaders of a custom material from ${url}`,
			() =>
				this.loadFile(url).then((list) => {
					const builds = list[index];
					if (!builds)
						throw new Error(
							`the file does not list the material at place ${index}, so it may come from another build`,
						);
					Object.assign(variants, builds);
					return undefined;
				}),
		);
	}

	/**
	 * Starts `load` under `key`, once, and returns the key. `what` names the download, after the
	 * code of its error, in the message of its failure.
	 */
	private download(
		key: string,
		what: string,
		load: () => Promise<FirstUseShaders | undefined>,
	): string {
		if (this.modules.has(key)) return key;
		this.modules.set(
			key,
			load().then(
				(more) => {
					this.settled.add(key);
					return more;
				},
				(error: unknown) => {
					this.failures.set(key, `${what} did not download: ${reasonOf(error)}.`);
					this.settled.add(key);
					return undefined;
				},
			),
		);
		return key;
	}

	/** Adds another module's builds to the variants of each shader, which keep their own. */
	private add(more: FirstUseShaders): void {
		const held = this.shaders as unknown as Record<string, Record<string, ShaderVariant>>;
		for (const [name, variants] of Object.entries(more)) {
			const into = held[name];
			if (into) Object.assign(into, variants);
		}
	}
}

/** The key of a module: the feature that loads on first use, if any, and the fixed bits. */
function moduleKey(feature: string | undefined, bits: number): string {
	return feature === undefined ? `${bits}` : `${feature} ${bits}`;
}
