// The engine's shaders that load by device, as the thread that draws holds them. A page loads the
// one module of its device's fixed permutation bits. A pipeline can still ask for a variant with
// other fixed bits: when a sketch turns on an effect that needs HDR color on the 8-bit path, the
// core switches to HDR color, and its pipelines then lack the tone mapping bit. The set then loads
// the module of those bits, once, and adds its builds to the variants that the backends already
// hold, so their templates find them. Until it arrives, the pipeline waits as a custom material's
// pipeline waits for its shader, and the frames that need it wait with it.

import { PERMUTATION_DRAW_INDEX, PERMUTATION_HALF, PERMUTATION_TONE_MAP } from '../generated/gpu';
import type { DeviceShaders, ShaderVariant, ShaderVariants } from '../generated/shaders';
import { variantFor } from './variants';

/** The permutation bits that a device fixes and that a pipeline's word can hold. */
const PIPELINE_DEVICE_BITS = PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP;

/** The device shaders that a backend reads, which grow by another module when a pipeline needs it. */
export class DeviceShaderSet {
	/** The fixed bits of each module that this set loaded or is loading. */
	private readonly modules = new Set<number>();
	/** The fixed bits of each module whose builds the set holds, or that failed to load. */
	private readonly settled = new Set<number>();
	/** Why each module that failed to load failed, by its fixed bits. */
	private readonly failures = new Map<number, unknown>();

	/**
	 * `shaders` are the builds of the module with the fixed bits `bits`, which the backends hold.
	 * `load` loads the module of other fixed bits.
	 */
	constructor(
		readonly shaders: DeviceShaders,
		private readonly bits: number,
		private readonly load: (bits: number) => Promise<DeviceShaders>,
	) {
		this.modules.add(bits);
		this.settled.add(bits);
	}

	/**
	 * True when `variants` hold a build for `permutation` with output for `target`, or when the
	 * module that would hold it has loaded, so the backend can build the pipeline or report its
	 * error. Otherwise it starts to load that module, once, and returns false until it has. It
	 * throws when that module failed to load, with the reason.
	 */
	ready(variants: ShaderVariants, permutation: number, target: 'wgsl' | 'glsl'): boolean {
		if (variantFor(variants, permutation, target)) return true;
		const bits = (permutation & PIPELINE_DEVICE_BITS) | (this.bits & PERMUTATION_HALF);
		if (this.modules.has(bits)) {
			if (this.failures.has(bits)) {
				const reason = this.failures.get(bits);
				throw new Error(
					`the engine could not download the shaders that a pipeline needs: ${reason instanceof Error ? reason.message : String(reason)}. Check the network, and that the page's build is deployed whole`,
					{ cause: reason },
				);
			}
			return this.settled.has(bits);
		}
		this.modules.add(bits);
		this.load(bits).then(
			(more) => {
				this.add(more);
				this.settled.add(bits);
			},
			(error: unknown) => {
				this.failures.set(bits, error);
				this.settled.add(bits);
			},
		);
		return false;
	}

	/** Adds another module's builds to the variants of each shader, which keep their own. */
	private add(more: DeviceShaders): void {
		const held = this.shaders as unknown as Record<string, Record<string, ShaderVariant>>;
		for (const [name, variants] of Object.entries(more)) {
			const into = held[name];
			if (into) Object.assign(into, variants);
		}
	}
}
