// The engine's shaders that load by device, as the thread that draws holds them. A page loads the
// one module of its device's fixed permutation bits. A pipeline can still ask for a variant with
// other fixed bits: when a sketch turns on an effect that needs HDR color on the 8-bit path, the
// core switches to HDR color, and its pipelines then lack the tone mapping bit. The set then loads
// the module of those bits, once, and adds its builds to the variants that the backends already
// hold, so their templates find them. The builds of a feature that loads on first use, such as
// sprites or bloom, sit in modules of the feature's own, and the builds that need several such
// features, such as a skinned build of the alpha hash, in modules of their own: the set loads one
// in the same way the first time a pipeline asks for one of their builds. Until a module arrives,
// the pipeline waits as a custom material's pipeline waits for its shader. Before the first frame,
// the frame waits with it. After it, frames go on, and what the pipeline draws appears once it is
// built.

import { PERMUTATION_DRAW_INDEX, PERMUTATION_HALF, PERMUTATION_TONE_MAP } from '../generated/gpu';
import {
	type DeviceShaders,
	FEATURE_JOIN,
	type FirstUseShaders,
	firstUseFile,
	type ShaderVariant,
	type ShaderVariants,
} from '../generated/shaders';
import { variantFor } from './variants';

/**
 * The permutation bits that stay as the device fixed them for the whole run: the draw index and
 * half precision. Every mesh pipeline of a device with the draw index holds it. A full-screen
 * pass's word lacks it, as its shader has no build with it, yet a feature's module that holds
 * both kinds of build is the one of the device's bits. Tone mapping is the one fixed bit that a
 * pipeline's word can change.
 */
const RUN_BITS = PERMUTATION_DRAW_INDEX | PERMUTATION_HALF;

/**
 * Features that move the 8-bit path to HDR color, whose pipelines then ask for builds without the
 * tone mapping bit. Preloading one on that path also loads the start's builds without the bit.
 */
const HDR_FEATURES: ReadonlySet<string> = new Set([
	'bloom',
	'bounce',
	'dof',
	'exposure',
	'fog_volume',
	'taa',
]);

/**
 * Loads a device module: the start's module of the fixed bits `bits` when `file` is undefined, or
 * else the module of the features that load on first use that `file` names, as `firstUseFile`
 * gives it, for a device with those bits.
 */
export type DeviceModuleLoader = (
	bits: number,
	file: string | undefined,
) => Promise<FirstUseShaders>;

/** The device shaders that a backend reads, which grow by another module when a pipeline needs it. */
export class DeviceShaderSet {
	/**
	 * Each module that this set loaded or is loading, by its key: its features and fixed bits. Each
	 * resolves to the module's builds, or to nothing when it failed to load.
	 */
	private readonly modules = new Map<string, Promise<FirstUseShaders | undefined>>();
	/** The features that a preload asked for. */
	private readonly wanted = new Set<string>();
	/** The key of each module that a preload asked for. */
	private readonly preloaded = new Set<string>();
	/** The modules that a preload asked for and that arrived, with their features. */
	private readonly arrived: [readonly string[], FirstUseShaders][] = [];
	/** Hears each module that a preload asked for, once it arrives. */
	private listener: ((features: readonly string[], module: FirstUseShaders) => void) | undefined;
	/** The key of each module whose builds the set holds, or that failed to load. */
	private readonly settled = new Set<string>();
	/** Why each module that failed to load failed, by its key. */
	private readonly failures = new Map<string, unknown>();
	/** The name of each shader whose variants the backends hold, by those variants. */
	private readonly names = new Map<ShaderVariants, string>();

	/**
	 * `shaders` are the builds of the start's module with the fixed bits `bits`, which the backends
	 * hold, with an entry for every shader that loads by device. `load` loads another module.
	 * `files` are the keys of the target's modules of features that load on first use.
	 */
	constructor(
		readonly shaders: DeviceShaders,
		private readonly bits: number,
		private readonly load: DeviceModuleLoader,
		private readonly files: readonly string[] = [],
	) {
		const key = moduleKey(undefined, bits);
		this.modules.set(key, Promise.resolve(undefined));
		this.settled.add(key);
		for (const [name, variants] of Object.entries(shaders)) this.names.set(variants, name);
	}

	/**
	 * True when `variants` hold a build for `permutation` with output for `target`, or when the
	 * module that would hold it has loaded, so the backend can build the pipeline or report its
	 * error. Otherwise it starts to load that module, once, and returns false until it has. It
	 * throws when that module failed to load, with the reason.
	 */
	ready(variants: ShaderVariants, permutation: number, target: 'wgsl' | 'glsl'): boolean {
		if (variantFor(variants, permutation, target)) return true;
		const bits = (permutation & PERMUTATION_TONE_MAP) | (this.bits & RUN_BITS);
		const name = this.names.get(variants);
		const file = name === undefined ? undefined : firstUseFile(name, permutation);
		const key = this.loadModule(file, bits);
		if (this.failures.has(key)) {
			const reason = this.failures.get(key);
			throw new Error(
				`the engine could not download the shaders that a pipeline needs: ${reason instanceof Error ? reason.message : String(reason)}. Check the network, and that the page's build is deployed whole`,
				{ cause: reason },
			);
		}
		return this.settled.has(key);
	}

	/**
	 * Loads the modules of `features`, which load on first use, for this device's fixed bits, so
	 * that their pipelines need not wait for a download: each feature's own module, and each module
	 * of builds that need several features, once a preload has asked for all of them. A module that
	 * the set loaded or is loading loads only once. Resolves once each module has arrived or failed
	 * to.
	 */
	preload(features: Iterable<string>): Promise<void> {
		for (const feature of features) this.wanted.add(feature);
		const bits = this.bits & (RUN_BITS | PERMUTATION_TONE_MAP);
		const keys: string[] = [];
		const ask = (file: string, needs: readonly string[], at: number) => {
			const key = this.loadModule(file, at);
			keys.push(key);
			if (this.preloaded.has(key)) return;
			this.preloaded.add(key);
			void this.modules.get(key)?.then((module) => {
				if (!module) return;
				this.arrived.push([needs, module]);
				this.listener?.(needs, module);
			});
		};
		for (const file of filesFor(this.files, this.wanted)) {
			const needs = file.split(FEATURE_JOIN);
			ask(file, needs, bits);
			if (needs.some((feature) => HDR_FEATURES.has(feature)) && bits & PERMUTATION_TONE_MAP) {
				const hdr = bits & ~PERMUTATION_TONE_MAP;
				keys.push(this.loadModule(undefined, hdr));
				ask(file, needs, hdr);
			}
		}
		return Promise.all(keys.map((key) => this.modules.get(key))).then(() => undefined);
	}

	/**
	 * Hands each module that a preload asked for to `listener` once it arrives, with the features
	 * that its builds need: those that arrived already, at once. A backend starts to build their
	 * shaders, so the features' first objects wait less.
	 */
	onPreloaded(listener: (features: readonly string[], module: FirstUseShaders) => void): void {
		this.listener = listener;
		for (const [features, module] of this.arrived) listener(features, module);
	}

	/** Starts to load the module of `file` and `bits`, once, and returns its key. */
	private loadModule(file: string | undefined, bits: number): string {
		const key = moduleKey(file, bits);
		if (this.modules.has(key)) return key;
		this.modules.set(
			key,
			this.load(bits, file).then(
				(more) => {
					this.add(more);
					this.settled.add(key);
					return more;
				},
				(error: unknown) => {
					this.failures.set(key, error);
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

/**
 * The keys among `files`, keys of modules of features that load on first use, whose features
 * `features` all hold: those modules hold only builds that a page with those features may draw.
 */
export function filesFor(files: readonly string[], features: ReadonlySet<string>): string[] {
	return files.filter((file) => file.split(FEATURE_JOIN).every((feature) => features.has(feature)));
}

/** The key of a module: the key of its features that load on first use, if any, and the fixed bits. */
function moduleKey(file: string | undefined, bits: number): string {
	return file === undefined ? `${bits}` : `${file} ${bits}`;
}
