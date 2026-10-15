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
// built. A module that fails to download is reported as E1406, and the next pipeline that needs it
// after a wait loads it again; in hold mode the failure stops the drawing instead.

import { reasonOf } from '../errors/message';
import { PERMUTATION_DRAW_INDEX, PERMUTATION_HALF, PERMUTATION_TONE_MAP } from '../generated/gpu';
import {
	type DeviceShaders,
	FEATURE_JOIN,
	type FirstUseShaders,
	firstUseFile,
	type ShaderVariant,
	type ShaderVariants,
} from '../generated/shaders';
import { FirstUse } from '../shared/first-use';
import { variantFor } from './variants';

/** Where the set reports the modules that failed to download, and whether a failure stops it. */
export interface ShaderLoadReport {
	/** Hears each failed download as a coded message. */
	reportFailure(message: string): void;
	/** True in hold mode: a pipeline that needs a module that failed throws. */
	readonly failFast: boolean;
}

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
const HDR_FEATURES: ReadonlySet<string> = new Set(['bloom', 'dof', 'exposure', 'fog_volume']);

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
	 * The load of each module that this set asked for, by its key: its features and fixed bits. Each
	 * gives the module's builds, or nothing for the start's module.
	 */
	private readonly modules = new Map<string, FirstUse<FirstUseShaders | undefined>>();
	/** The features that a preload asked for. */
	private readonly wanted = new Set<string>();
	/** The key of each module that a preload asked for. */
	private readonly preloaded = new Set<string>();
	/** The modules that a preload asked for and that arrived, with their features. */
	private readonly arrived: [readonly string[], FirstUseShaders][] = [];
	/** Hears each module that a preload asked for, once it arrives. */
	private listener: ((features: readonly string[], module: FirstUseShaders) => void) | undefined;
	/** The key of each module whose builds the set holds. */
	private readonly settled = new Set<string>();
	/**
	 * The code that joins the engine's effects into one shader, which loads with the first group
	 * of effects that a pipeline joins.
	 */
	readonly joiner = new FirstUse(
		() => import('./effect-joiner'),
		(error) =>
			this.report.reportFailure(`E1406: the effect joiner did not download: ${reasonOf(error)}.`),
	);
	/** The name of each shader whose variants the backends hold, by those variants. */
	private readonly names = new Map<ShaderVariants, string>();

	/**
	 * `shaders` are the builds of the start's module with the fixed bits `bits`, which the backends
	 * hold, with an entry for every shader that loads by device. `load` loads another module.
	 * `files` are the keys of the target's modules of features that load on first use. `report`
	 * hears each module that failed to download.
	 */
	constructor(
		readonly shaders: DeviceShaders,
		private readonly bits: number,
		private readonly load: DeviceModuleLoader,
		private readonly files: readonly string[] = [],
		private readonly report: ShaderLoadReport = { reportFailure() {}, failFast: true },
	) {
		const key = moduleKey(undefined, bits);
		this.modules.set(key, new FirstUse(() => Promise.resolve(undefined)));
		this.settled.add(key);
		for (const [name, variants] of Object.entries(shaders)) this.names.set(variants, name);
	}

	/**
	 * True when `variants` hold a build for `permutation` with output for `target`, or when the
	 * module that would hold it has loaded, so the backend can build the pipeline or report its
	 * error. Otherwise it starts to load that module and returns false until it has. A module that
	 * failed loads again after a wait; in hold mode the failure throws E1406.
	 */
	ready(variants: ShaderVariants, permutation: number, target: 'wgsl' | 'glsl'): boolean {
		if (variantFor(variants, permutation, target)) return true;
		const bits = (permutation & PERMUTATION_TONE_MAP) | (this.bits & RUN_BITS);
		const name = this.names.get(variants);
		const file = name === undefined ? undefined : firstUseFile(name, permutation);
		const key = this.loadModule(file, bits);
		if (this.settled.has(key)) return true;
		const { error } = this.modules.get(key) as FirstUse<unknown>;
		if (error !== undefined && this.report.failFast) throw new Error(failureMessage(error));
		return false;
	}

	/**
	 * What `use` loaded, or undefined while it loads, for a pipeline that waits for code that loads
	 * on first use. The first call starts the load, and after a failure a call after the wait loads
	 * again; in hold mode the failure throws.
	 */
	loaded<T>(use: FirstUse<T>): T | undefined {
		if (use.value !== undefined) return use.value;
		if (use.error !== undefined && this.report.failFast) throw new Error(failureMessage(use.error));
		void use.get();
		return undefined;
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
			void this.modules
				.get(key)
				?.get()
				.then(
					(module) => {
						if (!module) return;
						this.arrived.push([needs, module]);
						this.listener?.(needs, module);
					},
					() => undefined,
				);
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
		return Promise.all(keys.map((key) => this.modules.get(key)?.settled())).then(() => undefined);
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

	/**
	 * Starts to load the module of `file` and `bits` unless the set holds it, and returns its key.
	 * A load under way, or one that failed within its wait, does not start again.
	 */
	private loadModule(file: string | undefined, bits: number): string {
		const key = moduleKey(file, bits);
		if (this.settled.has(key)) return key;
		let load = this.modules.get(key);
		if (!load) {
			load = new FirstUse(
				() =>
					this.load(bits, file).then((more) => {
						this.add(more);
						this.settled.add(key);
						return more;
					}),
				(error) => this.report.reportFailure(failureMessage(error)),
			);
			this.modules.set(key, load);
		}
		void load.get();
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

/** The coded message of a module of shaders that did not download. */
function failureMessage(error: unknown): string {
	return `E1406: the engine's shaders that a pipeline needs did not download: ${reasonOf(error)}.`;
}

/** The key of a module: the key of its features that load on first use, if any, and the fixed bits. */
function moduleKey(file: string | undefined, bits: number): string {
	return file === undefined ? `${bits}` : `${file} ${bits}`;
}
