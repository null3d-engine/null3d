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

import { PERMUTATION_DRAW_INDEX, PERMUTATION_HALF, PERMUTATION_TONE_MAP } from '../generated/gpu';
import {
	type DeviceShaders,
	type FirstUseShaders,
	firstUseFeature,
	type ShaderVariant,
	type ShaderVariants,
} from '../generated/shaders';
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

/** The device shaders that a backend reads, which grow by another module when a pipeline needs it. */
export class DeviceShaderSet {
	/** Each module that this set loaded or is loading, by its key: its feature and fixed bits. */
	private readonly modules = new Map<string, Promise<void>>();
	/** The key of each module whose builds the set holds, or that failed to load. */
	private readonly settled = new Set<string>();
	/** The name of each shader whose variants the backends hold, by those variants. */
	private readonly names = new Map<ShaderVariants, string>();

	/**
	 * `shaders` are the builds of the start's module with the fixed bits `bits`, which the backends
	 * hold, with an entry for every shader that loads by device. `load` loads another module.
	 */
	constructor(
		readonly shaders: DeviceShaders,
		private readonly bits: number,
		private readonly load: DeviceModuleLoader,
	) {
		const key = moduleKey(undefined, bits);
		this.modules.set(key, Promise.resolve());
		this.settled.add(key);
		for (const [name, variants] of Object.entries(shaders)) this.names.set(variants, name);
	}

	/**
	 * True when `variants` hold a build for `permutation` with output for `target`, or when the
	 * module that would hold it has settled, so the backend can build the pipeline or report its
	 * error. Otherwise it starts to load that module, once, and returns false until it has.
	 */
	ready(variants: ShaderVariants, permutation: number, target: 'wgsl' | 'glsl'): boolean {
		if (variantFor(variants, permutation, target)) return true;
		const bits = (permutation & PIPELINE_DEVICE_BITS) | (this.bits & PERMUTATION_HALF);
		const name = this.names.get(variants);
		const feature = name === undefined ? undefined : firstUseFeature(name, permutation);
		const key = this.loadModule(feature, bits);
		return this.settled.has(key);
	}

	/**
	 * Loads the modules of `features`, which load on first use, for this device's fixed bits, so
	 * that their pipelines need not wait for a download. A module that the set loaded or is loading
	 * loads only once. Resolves once each module has arrived or failed to.
	 */
	preload(features: Iterable<string>): Promise<void> {
		const bits = this.bits & (PIPELINE_DEVICE_BITS | PERMUTATION_HALF);
		const keys: string[] = [];
		for (const feature of features) {
			keys.push(this.loadModule(feature, bits));
			if (HDR_FEATURES.has(feature) && bits & PERMUTATION_TONE_MAP) {
				const hdr = bits & ~PERMUTATION_TONE_MAP;
				keys.push(this.loadModule(undefined, hdr), this.loadModule(feature, hdr));
			}
		}
		return Promise.all(keys.map((key) => this.modules.get(key))).then(() => undefined);
	}

	/** Starts to load the module of `feature` and `bits`, once, and returns its key. */
	private loadModule(feature: string | undefined, bits: number): string {
		const key = moduleKey(feature, bits);
		if (this.modules.has(key)) return key;
		const settle = () => {
			this.settled.add(key);
		};
		this.modules.set(
			key,
			this.load(bits, feature).then((more) => {
				this.add(more);
				settle();
			}, settle),
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
