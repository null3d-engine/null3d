// The public feature description: one shape that an add-on declares for a render feature. It names
// the frame point where the feature records, the scene resources it reads and writes, the textures
// it publishes with neutral defaults, the lighting slots it provides, the views it draws in, and
// the callbacks that ready, quality, resize, reset and destroy call. defineFeature checks a
// description and fills its defaults. FeatureRegistry keeps the registered features and the names
// that only one of them may own.
//
// A feature's callbacks run on the sketch's thread, where the add-on's code runs. The declarations
// stay data. The engine's own renderer features stay internal and do not use this API: a feature
// that leaves the core uses it like any add-on (D-173, D-199).

import { EngineError } from '../errors/engine-error';
import type { QualityPreset, QualitySettings } from '../quality/presets';

/**
 * The point of a frame where a feature records its work, from the shadow passes to the display. A
 * feature declares one point.
 *
 * @category api/features
 */
export type FeatureFrame = 'shadow' | 'background' | 'opaque' | 'transparent' | 'resolve' | 'post';

/**
 * How a feature records at its frame point.
 *
 * @category api/features
 */
export type FeatureKind = 'draw' | 'compute' | 'fullscreen';

/**
 * The band that orders a feature against the engine's own work at its frame point.
 *
 * @category api/features
 */
export type FeatureBand = 'before' | 'normal' | 'after';

/**
 * A scene resource that a feature reads or writes. The render graph orders the feature around the
 * passes that write and read the same resource.
 *
 * @category api/features
 */
export type FeatureResource =
	| 'sceneColor'
	| 'sceneDepth'
	| 'normals'
	| 'motionVectors'
	| 'history'
	| 'shadowAtlas';

/**
 * A lighting slot that a feature provides. One feature provides each slot: a second provider would
 * give the scene two answers for one kind of light.
 *
 * @category api/features
 */
export type FeatureSlot = 'shadow' | 'ambient' | 'sky' | 'ao' | 'reflection' | 'fog';

/**
 * A view that a feature records in, as its view mask.
 *
 * @category api/features
 */
export type FeatureView = 'main' | 'scenePass' | 'reflection';

/**
 * The value that readers see from an output while its feature is absent, switched off or not
 * ready.
 *
 * @category api/features
 */
export type FeatureNeutral = 'black' | 'white' | 'transparent';

/**
 * Why a feature must drop the history that it keeps from earlier frames.
 *
 * @category api/features
 */
export type FeatureReset = 'resize' | 'camera' | 'exposure';

/**
 * The render size in device pixels, which the engine gives a feature when it changes.
 *
 * @category api/features
 */
export interface FeatureSize {
	/** The render size's width in device pixels. */
	readonly width: number;
	/** The render size's height in device pixels. */
	readonly height: number;
	/** The share of the canvas that the engine draws, from the quality settings. */
	readonly renderScale: number;
}

/**
 * A texture that a feature publishes to materials, effects and passes, by name. The neutral default
 * fills readers while the feature is absent or not ready, so a missing feature breaks nothing
 * downstream.
 *
 * @category api/features
 */
export interface FeatureOutput {
	/**
	 * The value that readers see while the feature is absent, switched off or not ready: `'black'`
	 * for zeros, `'white'` for ones, or `'transparent'` for zeros in every channel, alpha included.
	 */
	readonly default: FeatureNeutral;
}

/**
 * One add-on render feature, as the engine reads it. Every add-on hook that records frame work
 * declares a description of this shape: the frame point where it records, what it reads and
 * writes, what it publishes, the lighting slot it provides, its order band and view mask, and the
 * callbacks that the engine calls. `defineFeature` fills the neutral defaults and checks the
 * description.
 *
 * @category api/features
 */
export interface FeatureDescription {
	/**
	 * The feature's name, from 1 to 64 characters without a line break. It names the feature in
	 * errors, in `render.dumpGraph()` and in the stats overlay's GPU scope.
	 */
	readonly name: string;
	/**
	 * The frame point where the feature records. Leave it out for a feature that publishes data and
	 * records no frame work, such as a loader or a bake.
	 */
	readonly frame?: FeatureFrame;
	/**
	 * How the feature records: `'draw'` for scene objects, `'compute'` for compute shaders, or
	 * `'fullscreen'` for a triangle over a texture. A feature with a frame gives its kind. A compute
	 * feature publishes its results as outputs and writes no scene resource.
	 */
	readonly kind?: FeatureKind;
	/**
	 * The band that orders the feature against the engine's own work at its frame point: `'before'`,
	 * `'normal'` with it, or `'after'` it. It is `'normal'` by default.
	 */
	readonly band?: FeatureBand;
	/**
	 * The feature's place inside its band, as a whole number in the band's range. A lower number
	 * runs first. It is the band's first place by default, which is 0 for `'normal'`.
	 */
	readonly order?: number;
	/** The scene resources that the feature reads. The graph runs it after their writers. */
	readonly reads?: readonly FeatureResource[];
	/** The scene resources that the feature writes. The graph runs its readers after it. */
	readonly writes?: readonly FeatureResource[];
	/**
	 * The textures that the feature publishes to materials, effects and passes, by name, each with
	 * the neutral value that readers see while the feature is absent or not ready. Output names are
	 * unique across the engine's features.
	 */
	readonly outputs?: Readonly<Record<string, FeatureOutput>>;
	/** The lighting slots that the feature provides. One feature provides each slot. */
	readonly provides?: readonly FeatureSlot[];
	/**
	 * The views that the feature records in, as its view mask: the main camera's view, a scene
	 * pass's view, or a reflection pass's view. It is `['main']` by default. A feature with no frame
	 * records in no view.
	 */
	readonly views?: readonly FeatureView[];
	/**
	 * Called when the engine needs to know whether the feature draws. False means no cost at all: no
	 * pass, no target, and none of its code or shaders downloads. It is ready by default.
	 */
	readonly ready?: () => boolean;
	/**
	 * Called when the preset or its settings change, with the preset and the settings in use. The
	 * feature maps the engine's quality onto its own settings here.
	 */
	readonly quality?: (preset: QualityPreset, settings: Readonly<QualitySettings>) => void;
	/** Called when the render size changes, after the engine takes the new size. */
	readonly resize?: (size: FeatureSize) => void;
	/** Called when the feature must drop the history that it keeps from earlier frames. */
	readonly reset?: (reason: FeatureReset) => void;
	/** Called once when the feature is removed or the engine stops. Free the feature's own objects. */
	readonly destroy?: () => void;
}

/** The frame points, in the order that a frame runs them. */
const FRAMES: readonly FeatureFrame[] = [
	'shadow',
	'background',
	'opaque',
	'transparent',
	'resolve',
	'post',
];

/** The ways that a feature records. */
const KINDS: readonly FeatureKind[] = ['draw', 'compute', 'fullscreen'];

/** The kind, or kinds, that each frame point takes. */
const FRAME_KINDS: Readonly<Record<FeatureFrame, readonly FeatureKind[]>> = {
	shadow: ['draw'],
	background: ['draw', 'compute', 'fullscreen'],
	opaque: ['draw', 'compute', 'fullscreen'],
	transparent: ['draw', 'compute', 'fullscreen'],
	resolve: ['compute', 'fullscreen'],
	post: ['compute', 'fullscreen'],
};

/** The scene resources. */
const RESOURCES: readonly FeatureResource[] = [
	'sceneColor',
	'sceneDepth',
	'normals',
	'motionVectors',
	'history',
	'shadowAtlas',
];

/** The lighting slots. */
const SLOTS: readonly FeatureSlot[] = ['shadow', 'ambient', 'sky', 'ao', 'reflection', 'fog'];

/** The views. */
const VIEWS: readonly FeatureView[] = ['main', 'scenePass', 'reflection'];

/** The bands. */
const BANDS: readonly FeatureBand[] = ['before', 'normal', 'after'];

/** The range of orders that each band takes. */
const BAND_ORDERS: Readonly<Record<FeatureBand, readonly [number, number]>> = {
	before: [-1_048_576, -1],
	normal: [0, 1_048_575],
	after: [1_048_576, 2_097_151],
};

/** The neutral values. */
const NEUTRALS: readonly FeatureNeutral[] = ['black', 'white', 'transparent'];

/** The longest name of a feature or an output. */
const NAME_MAX = 64;

/** The output names that mean a scene resource, and the canvas, which an output cannot take. */
const RESERVED_OUTPUTS: ReadonlySet<string> = new Set(['canvas', ...RESOURCES]);

/** The description's options, which the check refuses when it meets another one. */
const TAKES: ReadonlySet<string> = new Set([
	'name',
	'frame',
	'kind',
	'band',
	'order',
	'reads',
	'writes',
	'outputs',
	'provides',
	'views',
	'ready',
	'quality',
	'resize',
	'reset',
	'destroy',
]);

/** The outputs of a feature that publishes none. */
const NO_OUTPUTS: Readonly<Record<string, FeatureOutput>> = Object.freeze(Object.create(null));

/** E1223 for a description that the engine cannot take. */
function invalid(call: string, detail: string): EngineError {
	return new EngineError('E1223', `${call}() ${detail}`);
}

/** The values as a list of choices, such as `'draw', 'compute' or 'fullscreen'`. */
function choices(values: readonly string[]): string {
	const quoted = values.map((value) => `'${value}'`);
	if (quoted.length <= 1) return quoted[0] ?? 'none';
	return `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`;
}

/** The name of a feature or an output, or throws E1223. */
function checkName(value: unknown, call: string, what: string): string {
	if (
		typeof value !== 'string' ||
		value.length < 1 ||
		value.length > NAME_MAX ||
		value.includes('\n')
	)
		throw invalid(
			call,
			`got the ${what} ${JSON.stringify(value)}; it takes a string of 1 to ${NAME_MAX} characters, without a line break.`,
		);
	return value;
}

/** One value from `values`, or throws E1223. */
function checkOne<T extends string>(
	value: unknown,
	values: readonly T[],
	call: string,
	what: string,
): T {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value))
		throw invalid(call, `got the ${what} ${JSON.stringify(value)}; it takes ${choices(values)}.`);
	return value as T;
}

/** The resources or slots that `value` lists, each once, or throws E1223. */
function checkList<T extends string>(
	value: unknown,
	values: readonly T[],
	call: string,
	what: string,
	field: string,
): readonly T[] {
	if (value === undefined) return [];
	if (!Array.isArray(value))
		throw invalid(call, `got ${field} ${JSON.stringify(value)}; it takes an array.`);
	const out: T[] = [];
	for (const item of value) {
		const one = checkOne(item, values, call, `${what} in ${field}`);
		if (out.includes(one))
			throw invalid(call, `got the ${what} '${one}' twice in ${field}; give each one once.`);
		out.push(one);
	}
	return Object.freeze(out);
}

/** The outputs that `value` declares, each with a neutral default, or throws E1223. */
function checkOutputs(value: unknown, call: string): Readonly<Record<string, FeatureOutput>> {
	if (value === undefined) return NO_OUTPUTS;
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw invalid(
			call,
			`got outputs ${JSON.stringify(value)}; it takes an object of outputs by name.`,
		);
	const out: Record<string, FeatureOutput> = Object.create(null);
	for (const name of Object.keys(value)) {
		checkName(name, call, 'output name');
		if (RESERVED_OUTPUTS.has(name))
			throw invalid(
				call,
				`got the output name '${name}', which names a scene resource. Give each output a name of its own.`,
			);
		const output = (value as Record<string, unknown>)[name];
		if (typeof output !== 'object' || output === null || Array.isArray(output))
			throw invalid(
				call,
				`got ${JSON.stringify(output)} for the output '${name}'; give it { default: ${choices(NEUTRALS)} }.`,
			);
		const unknown = Object.keys(output).find((key) => key !== 'default');
		if (unknown !== undefined)
			throw invalid(
				call,
				`got the output option '${unknown}' for '${name}'; an output takes default alone.`,
			);
		const neutral = checkOne(
			(output as { default?: unknown }).default,
			NEUTRALS,
			call,
			`default of the output '${name}'`,
		);
		out[name] = Object.freeze({ default: neutral });
	}
	return Object.freeze(out);
}

/** The order that `value` gives for `band`, or throws E1223. */
function checkOrder(value: unknown, band: FeatureBand, call: string): number {
	const [low, high] = BAND_ORDERS[band];
	if (value === undefined) return low;
	if (!Number.isInteger(value) || (value as number) < low || (value as number) > high)
		throw invalid(
			call,
			`got the order ${String(value)} with the band '${band}'; the band takes a whole number from ${low} to ${high}.`,
		);
	return value as number;
}

/** Throws E1223 for a callback that is not a function. */
function checkCallback(value: unknown, call: string, what: string): void {
	if (value !== undefined && typeof value !== 'function')
		throw invalid(call, `got a ${what} that is not a function.`);
}

/**
 * A checked description with its defaults filled. The public type keeps the options optional, but
 * a registered feature always holds a value for each one.
 */
type NormalizedFeature = FeatureDescription & {
	readonly band: FeatureBand;
	readonly order: number;
	readonly reads: readonly FeatureResource[];
	readonly writes: readonly FeatureResource[];
	readonly outputs: Readonly<Record<string, FeatureOutput>>;
	readonly provides: readonly FeatureSlot[];
	readonly views: readonly FeatureView[];
};

/**
 * Checks a description and fills its neutral defaults: the band, the order, the kind's absence, the
 * empty lists, the default views and the outputs. It returns a frozen description, so a feature
 * that an engine thread reads cannot change under it.
 */
function normalize(description: FeatureDescription, call: string): NormalizedFeature {
	if (typeof description !== 'object' || description === null)
		throw invalid(call, `got ${String(description)}, which is not a feature description.`);
	for (const key of Object.keys(description))
		if (!TAKES.has(key))
			throw invalid(
				call,
				`got the option '${key}', which a feature description does not take. It takes ${choices([...TAKES])}.`,
			);
	const name = checkName(description.name, call, 'name');
	const frame =
		description.frame === undefined
			? undefined
			: checkOne(description.frame, FRAMES, call, 'frame');
	const band =
		description.band === undefined ? 'normal' : checkOne(description.band, BANDS, call, 'band');
	const order = checkOrder(description.order, band, call);
	const reads = checkList(description.reads, RESOURCES, call, 'resource', 'reads');
	const writes = checkList(description.writes, RESOURCES, call, 'resource', 'writes');
	const provides = checkList(description.provides, SLOTS, call, 'slot', 'provides');
	const views = checkList(description.views, VIEWS, call, 'view', 'views');
	const outputs = checkOutputs(description.outputs, call);
	checkCallback(description.ready, call, 'ready');
	checkCallback(description.quality, call, 'quality');
	checkCallback(description.resize, call, 'resize');
	checkCallback(description.reset, call, 'reset');
	checkCallback(description.destroy, call, 'destroy');
	let kind: FeatureKind | undefined;
	if (frame === undefined) {
		if (description.kind !== undefined)
			throw invalid(
				call,
				`got the kind '${String(description.kind)}' without a frame; a feature that records no frame work gives no kind.`,
			);
		if (reads.length > 0)
			throw invalid(
				call,
				'got reads without a frame; a feature that records no frame work reads no scene resource.',
			);
		if (writes.length > 0)
			throw invalid(
				call,
				'got writes without a frame; a feature that records no frame work writes no scene resource.',
			);
		if (views.length > 0)
			throw invalid(
				call,
				'got views without a frame; a feature that records no frame work draws in no view.',
			);
	} else {
		if (description.kind === undefined)
			throw invalid(
				call,
				`got the frame '${frame}' with no kind. Give the kind: ${choices(FRAME_KINDS[frame])}.`,
			);
		kind = checkOne(description.kind, KINDS, call, 'kind');
		const kinds = FRAME_KINDS[frame];
		if (!kinds.includes(kind))
			throw invalid(
				call,
				`got the kind '${kind}' with the frame '${frame}'; that frame takes ${choices(kinds)}.`,
			);
		if (kind === 'compute' && writes.length > 0)
			throw invalid(
				call,
				`got writes ${JSON.stringify(writes)} for a compute feature. A compute feature publishes its results as outputs.`,
			);
	}
	const common = {
		name,
		band,
		order,
		reads,
		writes,
		outputs,
		provides,
		...(description.ready === undefined ? {} : { ready: description.ready }),
		...(description.quality === undefined ? {} : { quality: description.quality }),
		...(description.resize === undefined ? {} : { resize: description.resize }),
		...(description.reset === undefined ? {} : { reset: description.reset }),
		...(description.destroy === undefined ? {} : { destroy: description.destroy }),
	};
	const normal = (
		frame === undefined
			? { ...common, views: Object.freeze([]) }
			: {
					...common,
					frame,
					kind: kind as FeatureKind,
					views: views.length > 0 ? views : Object.freeze(['main' as const]),
				}
	) as NormalizedFeature;
	return Object.freeze(normal);
}

/**
 * Declares one add-on render feature. The engine checks the description and fills its neutral
 * defaults, and returns a frozen copy: the `'normal'` band with order 0, empty reads and writes,
 * no outputs or lighting slots, and the main view, for a feature that records a frame point.
 *
 * Throws E1223 for an option that a description does not take, a name that is empty or longer than
 * 64 characters, a frame point or kind that does not exist or does not go together, an order
 * outside its band, an unknown resource, slot or view, or an output with no neutral default.
 *
 * @category api/features
 */
export function defineFeature(description: FeatureDescription): FeatureDescription {
	return normalize(description, 'defineFeature');
}

/**
 * The features that an add-on registers, with the rules that one feature alone cannot check: a name
 * that is unique, output names that are unique, and one provider for each lighting slot. A
 * registered feature holds the declarations that the engine turns into a render graph node.
 *
 * @category api/features
 */
export class FeatureRegistry {
	/** The registered features, by name, in the order that they were added. */
	private readonly descriptions = new Map<string, NormalizedFeature>();
	/** The feature that publishes each output. */
	private readonly outputs = new Map<string, string>();
	/** The feature that provides each lighting slot. */
	private readonly slots = new Map<FeatureSlot, string>();

	/** The number of registered features. */
	get size(): number {
		return this.descriptions.size;
	}

	/**
	 * Checks a description, registers it and returns the frozen description. Throws E1223 for a
	 * description that `defineFeature` refuses, a feature name that is registered already, an output
	 * name that another feature publishes, or a lighting slot that another feature provides.
	 */
	add(description: FeatureDescription): FeatureDescription {
		const call = 'FeatureRegistry.add';
		const feature = normalize(description, call);
		const registered = this.descriptions.get(feature.name);
		if (registered !== undefined)
			throw invalid(
				call,
				`got the feature '${feature.name}', which is registered already. Remove it first, or give the feature a name of its own.`,
			);
		for (const name of Object.keys(feature.outputs)) {
			const owner = this.outputs.get(name);
			if (owner !== undefined)
				throw invalid(
					call,
					`got the output '${name}', which the feature '${owner}' publishes already. Give each output a name of its own.`,
				);
		}
		for (const slot of feature.provides) {
			const owner = this.slots.get(slot);
			if (owner !== undefined)
				throw invalid(
					call,
					`got the slot '${slot}', which the feature '${owner}' provides already. One feature provides each lighting slot.`,
				);
		}
		this.descriptions.set(feature.name, feature);
		for (const name of Object.keys(feature.outputs)) this.outputs.set(name, feature.name);
		for (const slot of feature.provides) this.slots.set(slot, feature.name);
		return feature;
	}

	/**
	 * Removes the feature with `name`, and gives its output names and lighting slots to other
	 * features. Returns false when no feature has that name. It does not call the feature's
	 * `destroy`: stop the feature before it is removed.
	 */
	remove(name: string): boolean {
		const feature = this.descriptions.get(name);
		if (feature === undefined) return false;
		this.descriptions.delete(name);
		for (const output of Object.keys(feature.outputs)) this.outputs.delete(output);
		for (const slot of feature.provides) this.slots.delete(slot);
		return true;
	}

	/** The feature with `name`, or undefined. */
	get(name: string): FeatureDescription | undefined {
		return this.descriptions.get(name);
	}

	/**
	 * The neutral default of the output that `name` publishes, or undefined while no feature
	 * publishes it. A material or effect that reads the output shows this value in the meantime.
	 */
	outputDefault(name: string): FeatureNeutral | undefined {
		const owner = this.outputs.get(name);
		const output = owner === undefined ? undefined : this.descriptions.get(owner)?.outputs[name];
		return output?.default;
	}

	/** The feature that provides `slot`, or undefined while no feature provides it. */
	provider(slot: FeatureSlot): string | undefined {
		return this.slots.get(slot);
	}
}
