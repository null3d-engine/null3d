// The full-screen adapter of the public feature description: one add-on's pass over the whole
// image, which the engine places in the chain of custom effects from the description alone. The
// description gives the frame point, the order band and order, the scene resources that the pass
// reads and writes, and the ready callback that says whether it draws at all. The add-on gives the
// pass's WGSL, its uniforms and its textures, as it would to `post.addEffect`.
//
// The chain runs after the exposure and before bloom and the tone curve, so this adapter places
// the 'resolve' frame point alone. An effect reads the scene color as its input and returns the
// new color, so the description writes 'sceneColor'. A pass that declares 'sceneDepth' reads it
// with `effectDepth`, `effectViewPosition` or `effectDistance`, which turn the depth binding on.
//
// The effect is made while the feature is ready and removed while it is not, so a feature that a
// sketch switched off costs no pass, no target and no shader download. The adapter asks again when
// the engine's quality changes, and the add-on can ask with `refresh` after its own state changes.

import type { Effect, EffectOptions } from './effects';
import type { FeatureDescription, FeatureResource } from './features';
import type { CompiledWgsl } from './resources';
import type { UniformValue, UniformValues } from './wgsl-uniforms';

/**
 * Options of `post.addFeatureEffect` besides the feature description: the pass's WGSL, its first
 * uniform values and its textures, as `post.addEffect` takes them. The description gives the place
 * where the pass runs, so the options take no order.
 *
 * @category api/feature-effects
 */
export interface FeatureEffectOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl>
	extends Omit<EffectOptions<Wgsl>, 'order'> {}

/**
 * A full-screen feature that `post.addFeatureEffect` placed: the effect while the feature draws, and
 * its name, uniforms and removal.
 *
 * @category api/feature-effects
 */
export interface FeatureEffect<Values = UniformValues<string>> {
	/** The feature's name, from its description. */
	readonly name: string;
	/**
	 * The effect that runs, or undefined while the feature is not ready. A not-ready feature costs
	 * nothing: its pass, its target and its shaders wait until it is ready.
	 */
	readonly effect: Effect<Values> | undefined;
	/** True while the feature's pass runs. */
	readonly draws: boolean;
	/**
	 * Changes one uniform of the pass, as `post.setEffectUniform` does. A value that a not-ready
	 * feature takes applies when the feature next draws. It allocates nothing.
	 */
	setUniform<Name extends keyof Values & string>(
		name: Name,
		value: NonNullable<Values[Name]>,
	): void;
	/**
	 * Asks the feature's `ready` again, adds or removes its effect, and returns whether it draws
	 * now. The adapter calls it when the engine's quality changes; call it after a change that the
	 * sketch makes, such as a switch of its own.
	 */
	refresh(): boolean;
	/** Removes the pass and stops watching the quality. It calls the description's `destroy` once. */
	destroy(): void;
}

/**
 * What the adapter reads and writes: the effect chain's calls, the sketch's quality changes, and the
 * error that an unplaceable description throws. The post object makes them, so this module shares no
 * engine module with the start's files.
 *
 * @internal
 */
export interface FeatureEffectHost {
	addEffect(options: EffectOptions): Effect;
	removeEffect(effect: Effect): void;
	setUniform(effect: Effect, name: string, value: UniformValue): void;
	/** Calls `handler` when the engine's quality changes, and returns a function that stops it. */
	watch(handler: () => void): () => void;
	fail(detail: string): Error;
}

/** The scene resources that a full-screen effect gives the pass. */
const READS: readonly FeatureResource[] = ['sceneColor', 'sceneDepth'];

/** The effect template's helpers that read the scene's depth. */
const DEPTH_CALLS = 'effectDepth, effectViewPosition or effectDistance';

/**
 * Checks that a description is a full-screen pass this adapter can place, and returns whether it
 * declares the scene's depth. Throws E1223 for a description of another kind, at another frame
 * point, in another view, that declares another write, or that reads a resource the effect chain
 * does not give it.
 */
function checkFullscreen(
	description: FeatureDescription,
	host: FeatureEffectHost,
	call: string,
): boolean {
	const invalid = (detail: string) => host.fail(`${call}() ${detail}`);
	if (description.kind !== 'fullscreen')
		throw invalid(
			`got the feature '${description.name}' with the kind ${JSON.stringify(description.kind)}; a full-screen effect takes a description with the kind 'fullscreen'.`,
		);
	if (description.frame !== 'resolve')
		throw invalid(
			`got the feature '${description.name}' at the frame ${JSON.stringify(description.frame)}; a full-screen effect records at 'resolve', which the engine draws before the tone curve. No public pass draws an add-on's effect after the tone curve yet.`,
		);
	const views = description.views ?? ['main'];
	if (views.length !== 1 || views[0] !== 'main')
		throw invalid(
			`got the feature '${description.name}' with the views ${JSON.stringify(views)}; a full-screen effect records in the main view alone, because the adapter places no other view yet.`,
		);
	const reads = description.reads ?? [];
	for (const resource of reads)
		if (!READS.includes(resource))
			throw invalid(
				`got the feature '${description.name}' reading '${resource}'; a full-screen effect reads the scene's color and depth alone. Another resource needs a binding that the effect chain does not add yet.`,
			);
	if (!reads.includes('sceneColor'))
		throw invalid(
			`got the feature '${description.name}' with the reads ${JSON.stringify(reads)}; a full-screen effect reads the scene's color, which its WGSL returns changed. Give 'sceneColor'.`,
		);
	const writes = description.writes ?? [];
	if (writes.length !== 1 || writes[0] !== 'sceneColor')
		throw invalid(
			`got the feature '${description.name}' with the writes ${JSON.stringify(writes)}; a full-screen effect writes the scene's color alone. Give writes: ['sceneColor'].`,
		);
	const outputs = Object.keys(description.outputs ?? {});
	if (outputs.length > 0)
		throw invalid(
			`got the feature '${description.name}' publishing ${JSON.stringify(outputs)}; a full-screen effect publishes no texture. A feature with outputs becomes a compute pass, whose storage texture is its output.`,
		);
	const slots = description.provides ?? [];
	if (slots.length > 0)
		throw invalid(
			`got the feature '${description.name}' providing ${JSON.stringify(slots)}; a full-screen effect provides no lighting slot. A slot needs the pass that shades the scene's surfaces.`,
		);
	return reads.includes('sceneDepth');
}

/**
 * The placed feature: its effect while it draws, the values that it was given last, and the watch on
 * the engine's quality.
 *
 * @internal
 */
class PlacedFeatureEffect<Wgsl extends string | CompiledWgsl = string | CompiledWgsl>
	implements FeatureEffect
{
	private placed: Effect | undefined;
	private stopped = false;
	private readonly values = new Map<string, UniformValue>();
	private readonly unwatch: () => void;

	constructor(
		private readonly description: FeatureDescription,
		private readonly options: FeatureEffectOptions<Wgsl>,
		private readonly declaresDepth: boolean,
		private readonly host: FeatureEffectHost,
		private readonly call: string,
	) {
		const given = options.uniforms as Record<string, UniformValue> | undefined;
		if (given !== undefined)
			for (const name of Object.keys(given)) this.values.set(name, given[name] as UniformValue);
		this.unwatch = host.watch(() => this.refresh());
		try {
			this.refresh();
		} catch (error) {
			this.stopped = true;
			this.unwatch();
			throw error;
		}
	}

	get name(): string {
		return this.description.name;
	}

	get effect(): Effect | undefined {
		return this.placed;
	}

	get draws(): boolean {
		return this.placed !== undefined;
	}

	setUniform(name: string, value: UniformValue): void {
		this.values.set(name, value);
		if (this.placed !== undefined) this.host.setUniform(this.placed, name, value);
	}

	refresh(): boolean {
		if (this.stopped) return false;
		const wanted = this.description.ready === undefined || this.description.ready();
		if (wanted === this.draws) return wanted;
		if (wanted) this.place();
		else this.unplace();
		return wanted;
	}

	destroy(): void {
		if (this.stopped) return;
		this.unplace();
		this.stopped = true;
		this.unwatch();
		this.description.destroy?.();
	}

	/** Makes the effect with the values it was given last, and checks that its depth reads agree. */
	private place(): void {
		const uniforms: Record<string, UniformValue> = Object.create(null);
		for (const [name, value] of this.values) uniforms[name] = value;
		const placed = this.host.addEffect({
			...this.options,
			uniforms,
			order: this.description.order,
		} as EffectOptions);
		if (placed.depth !== this.declaresDepth) {
			this.host.removeEffect(placed);
			throw this.host.fail(
				`${this.call}() got the feature '${this.description.name}', whose reads ${
					this.declaresDepth ? "declare the scene's depth" : 'declare no scene depth'
				}, and WGSL that ${
					placed.depth ? `reads it with ${DEPTH_CALLS}` : 'does not read it'
				}. A feature declares exactly the scene resources that its WGSL reads.`,
			);
		}
		this.placed = placed;
	}

	/** Removes the effect, and keeps its values for the next time it is ready. */
	private unplace(): void {
		if (this.placed === undefined) return;
		this.host.removeEffect(this.placed);
		this.placed = undefined;
	}
}

/**
 * Places `description` as one full-screen pass in the chain of custom effects. Throws E1223 for a
 * description that this adapter cannot place, E1215 to E1216 for WGSL and values that the effect
 * chain refuses, and E1213 when the most effects already run.
 *
 * @internal
 */
export function createFeatureEffect<const Wgsl extends string | CompiledWgsl>(
	description: FeatureDescription,
	options: FeatureEffectOptions<Wgsl>,
	host: FeatureEffectHost,
	call = 'addFeatureEffect',
): FeatureEffect<UniformValues<Wgsl>> {
	const declaresDepth = checkFullscreen(description, host, call);
	return new PlacedFeatureEffect(
		description,
		options,
		declaresDepth,
		host,
		call,
	) as unknown as FeatureEffect<UniformValues<Wgsl>>;
}
