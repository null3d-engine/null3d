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

import { isEngineDebugView } from '../debug/view-names';
import { EngineError } from '../errors/engine-error';
import { BUDGET_STEPS } from '../quality/budget';
import {
	describeValues,
	presetIndex,
	type QualityPreset,
	type QualitySettings,
	type SettingValues,
	takesValue,
} from '../quality/presets';
import type { Tier } from '../shared/tier';

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
 * A scene resource that a custom material or a feature reads: the scene's color before the tone
 * curve, its depth, its surface normals, or how far each pixel's surface moved since the last
 * frame. A reader declares the input, and the engine binds what the frame makes.
 *
 * @category api/features
 */
export type SceneInput = 'sceneColor' | 'sceneDepth' | 'normals' | 'motionVectors';

/**
 * A scene resource that a feature reads or writes. The render graph orders the feature around the
 * passes that write and read the same resource. `history` is the image of an earlier frame that a
 * temporal effect keeps, and `shadowAtlas` holds the sun's cascades and the point and spot lights'
 * shadow tiles.
 *
 * @category api/features
 */
export type FeatureResource = SceneInput | 'history' | 'shadowAtlas';

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
 * The value of a feature's own setting: a number, a word or a flag. The engine resolves the value
 * from the setting's row for the preset, the GPU path and the governor's steps.
 *
 * @category api/features
 */
export type FeatureValue = number | string | boolean;

/**
 * What each of the frame-budget governor's steps does to a feature's setting.
 *
 * @category api/features
 */
export type FeatureGovernor = 'none' | 'scale' | 'double';

/**
 * One setting of a feature's own, with a value on each quality preset, like the engine's own rows
 * of the quality table. The engine checks each preset value against `values`, resolves the row for
 * the preset and the GPU path in use, and applies the governor's steps to it.
 *
 * @category api/features
 */
export interface FeatureSetting {
	/** The value on each preset, from Low to Ultra. */
	readonly presets: readonly [FeatureValue, FeatureValue, FeatureValue, FeatureValue];
	/**
	 * The value on each preset on WebGL2, from Low to Ultra, where WebGL2 differs. A preset without
	 * a value here takes the row's own value.
	 */
	readonly webgl2?: readonly [FeatureValue, FeatureValue, FeatureValue, FeatureValue];
	/**
	 * The values the setting takes: `'flag'` for true or false, a list of choices, or a range from
	 * a minimum to a maximum, where `whole` keeps it to whole numbers. The engine checks every
	 * preset value against them.
	 */
	readonly values:
		| 'flag'
		| readonly (string | number)[]
		| { readonly min: number; readonly max: number; readonly whole?: boolean };
	/**
	 * What each of the governor's budget steps does to the setting. `'scale'` takes the budget's
	 * share of the value, for a count that costs its number. `'double'` multiplies the value by two
	 * for each step taken, up to the highest value of its range, for an interval whose work happens
	 * less often. `'none'` keeps the preset's value. It is `'none'` by default. A setting that the
	 * governor steps needs the feature's `budget`, whose steps are what reach the setting.
	 */
	readonly governor?: FeatureGovernor;
}

/**
 * A feature's time budget per frame, at full quality, on each quality preset. The frame-budget
 * governor lowers the budget's share of full quality when frames take too long, and the feature
 * reads that share to lighten its own work.
 *
 * @category api/features
 */
export interface FeatureBudget {
	/** The time in ms that the feature may take in each frame at full quality, from Low to Ultra. */
	readonly presets: readonly [number, number, number, number];
	/**
	 * The lowest share of full quality that the governor gives the feature, from 0 to 1. The
	 * default is 0.
	 */
	readonly min?: number;
}

/**
 * What a feature reads while its quality callback runs: its own settings, as the engine resolved
 * them, and its budget's share of full quality after the governor's steps.
 *
 * @category api/features
 */
export interface FeatureQuality {
	/** The feature's own settings for the preset and GPU path in use, by name. */
	readonly settings: Readonly<Record<string, FeatureValue>>;
	/** The budget's share of full quality, from 0 to 1, or 1 without a budget. */
	readonly budgetScale: number;
	/** The time in ms that the feature may take in each frame now, or 0 without a budget. */
	readonly budgetMs: number;
}

/**
 * One feature's figures, as the stats overlay shows them beside the engine's own. A feature that
 * records frame work has one GPU timing scope, and `gpuMs` is that scope's time.
 *
 * @category api/features
 */
export interface FeatureStats {
	/** The feature's name. */
	readonly name: string;
	/** The feature's own settings, as the engine resolved them now. */
	readonly settings: Readonly<Record<string, FeatureValue>>;
	/**
	 * The GPU time per frame of the feature's scope, in ms, or null until the engine times a frame
	 * that records the feature's work.
	 */
	readonly gpuMs: number | null;
	/** The GPU bytes that the feature's own objects hold, or null where it reports none. */
	readonly bytes: number | null;
	/** The time in ms that the feature may take in each frame at full quality, or null without a budget. */
	readonly budgetMs: number | null;
	/** The time in ms that the feature may take in each frame now, or null without a budget. */
	readonly allowedMs: number | null;
}

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
 * A debug view that an add-on adds. `debug.view` and the page's `?view=` switch pick it by name,
 * and the engine tells the add-on when it starts and stops. The add-on draws the view itself, with
 * its own materials or its own debug drawing, so the engine needs no shader for it.
 *
 * @category api/features
 */
export interface FeatureDebugView {
	/**
	 * The name that `debug.view` and `?view=` take, from 1 to 64 characters without a line break.
	 * It must not name one of the engine's own views, or another add-on's view.
	 */
	readonly name: string;
	/**
	 * Called with `true` when this view becomes the active one, and with `false` when another view
	 * replaces it or the engine stops.
	 */
	readonly set: (active: boolean) => void;
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
	 * The debug views that the feature adds, each with the name that `debug.view` and `?view=`
	 * take and the callback that hears when it starts and stops. An add-on draws such a view
	 * itself, so `debug.view` reaches it without the engine building a shader for it.
	 */
	readonly debugViews?: readonly FeatureDebugView[];
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
	 * The feature's own settings, by name, each with a value on every preset and the values it
	 * takes. The engine resolves them for the preset and the GPU path in use, applies the governor's
	 * steps, and gives them to the `quality` callback. Names are the feature's own: two features may
	 * use the same name.
	 */
	readonly settings?: Readonly<Record<string, FeatureSetting>>;
	/**
	 * The feature's time budget per frame on each preset. The frame-budget governor lowers its share
	 * of full quality with the sketch's other budgets, and the feature reads the share from its
	 * `quality` callback. A feature that gives settings a `governor` needs a budget.
	 */
	readonly budget?: FeatureBudget;
	/**
	 * Returns the GPU bytes that the feature's own objects hold now, which the stats overlay shows
	 * beside the engine's own memory. The engine calls it when a figure of the feature changes, never
	 * in a frame.
	 */
	readonly memory?: () => number;
	/**
	 * Called when the preset or its settings change, with the preset and the settings in use, and
	 * with the feature's own resolved settings and budget share. The feature maps the engine's
	 * quality onto its own settings here.
	 */
	readonly quality?: (
		preset: QualityPreset,
		settings: Readonly<QualitySettings>,
		feature: FeatureQuality,
	) => void;
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
	'debugViews',
	'views',
	'ready',
	'settings',
	'budget',
	'memory',
	'quality',
	'resize',
	'reset',
	'destroy',
]);

/** The options of a feature's setting, which the check refuses when it meets another one. */
const SETTING_TAKES: ReadonlySet<string> = new Set(['presets', 'webgl2', 'values', 'governor']);

/** What the governor's steps do to a feature's setting. */
const GOVERNORS: readonly FeatureGovernor[] = ['none', 'scale', 'double'];

/** The keys of a range of values. */
const RANGE_TAKES: ReadonlySet<string> = new Set(['min', 'max', 'whole']);

/** The outputs of a feature that publishes none. */
const NO_OUTPUTS: Readonly<Record<string, FeatureOutput>> = Object.freeze(Object.create(null));

/** The settings of a feature that declares none. */
const NO_SETTINGS: Readonly<Record<string, FeatureSetting>> = Object.freeze(Object.create(null));

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

/** The debug views that `value` declares, each with a name of its own, or throws E1223. */
function checkDebugViews(value: unknown, call: string): readonly FeatureDebugView[] {
	if (value === undefined) return Object.freeze([]);
	if (!Array.isArray(value))
		throw invalid(
			call,
			`got debugViews ${JSON.stringify(value)}; it takes an array of { name, set }.`,
		);
	const out: FeatureDebugView[] = [];
	for (const view of value) {
		if (typeof view !== 'object' || view === null || Array.isArray(view))
			throw invalid(
				call,
				`got ${JSON.stringify(view)} in debugViews; give each view { name, set }.`,
			);
		const unknown = Object.keys(view).find((key) => key !== 'name' && key !== 'set');
		if (unknown !== undefined)
			throw invalid(
				call,
				`got the debug view option '${unknown}'; a debug view takes name and set.`,
			);
		const name = checkName((view as { name?: unknown }).name, call, 'debug view name');
		if (isEngineDebugView(name))
			throw invalid(
				call,
				`got the debug view name '${name}', which names one of the engine's own views. Give the add-on's view a name of its own.`,
			);
		if (out.some((one) => one.name === name))
			throw invalid(call, `got the debug view '${name}' twice; give each view a name of its own.`);
		const set = (view as { set?: unknown }).set;
		if (typeof set !== 'function')
			throw invalid(call, `got a debug view '${name}' whose set is not a function.`);
		out.push(Object.freeze({ name, set: set as (active: boolean) => void }));
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

/** The values that a feature's setting takes, or throws E1223. */
function checkSettingValues(value: unknown, call: string, name: string): SettingValues {
	const what = `values of the setting '${name}'`;
	if (value === 'flag') return value;
	if (Array.isArray(value)) {
		if (value.length === 0)
			throw invalid(call, `got ${what} as an empty list; give at least one choice.`);
		for (const item of value)
			if (typeof item !== 'number' && typeof item !== 'string')
				throw invalid(
					call,
					`got ${JSON.stringify(item)} in ${what}; each choice is a number or a word.`,
				);
		return Object.freeze([...value]) as readonly (string | number)[];
	}
	if (typeof value === 'object' && value !== null) {
		const range = value as Record<string, unknown>;
		for (const key of Object.keys(range))
			if (!RANGE_TAKES.has(key))
				throw invalid(
					call,
					`got the option '${key}' in ${what}; a range takes ${choices([...RANGE_TAKES])}.`,
				);
		const { min, max } = range;
		if (typeof min !== 'number' || typeof max !== 'number' || !(min <= max))
			throw invalid(
				call,
				`got ${what} ${JSON.stringify(value)}; a range takes a minimum and a maximum, the minimum first.`,
			);
		const out: { min: number; max: number; whole?: boolean } = { min, max };
		if (range.whole !== undefined) {
			if (typeof range.whole !== 'boolean')
				throw invalid(
					call,
					`got whole ${JSON.stringify(range.whole)} in ${what}; it is true or false.`,
				);
			out.whole = range.whole;
		}
		return Object.freeze(out);
	}
	throw invalid(
		call,
		`got ${what} ${JSON.stringify(value)}; it takes 'flag', a list of choices, or a range { min, max }.`,
	);
}

/** The four values of a feature setting's row, or throws E1223. */
function checkPresets(
	value: unknown,
	values: SettingValues,
	call: string,
	what: string,
): readonly [FeatureValue, FeatureValue, FeatureValue, FeatureValue] {
	if (!Array.isArray(value) || value.length !== 4)
		throw invalid(
			call,
			`got ${what} ${JSON.stringify(value)}; it takes one value for each preset, from Low to Ultra: four values.`,
		);
	for (const item of value)
		if (!takesValue(values, item))
			throw invalid(
				call,
				`got the value ${JSON.stringify(item)} in ${what}, which is not ${describeValues(values)}.`,
			);
	return Object.freeze([...value]) as readonly [
		FeatureValue,
		FeatureValue,
		FeatureValue,
		FeatureValue,
	];
}

/** The settings that `value` declares, each checked against its own values, or throws E1223. */
function checkSettings(
	value: unknown,
	call: string,
	hasBudget: boolean,
): Readonly<Record<string, FeatureSetting>> {
	if (value === undefined) return NO_SETTINGS;
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw invalid(
			call,
			`got settings ${JSON.stringify(value)}; give an object of settings by name.`,
		);
	const out: Record<string, FeatureSetting> = Object.create(null);
	for (const name of Object.keys(value)) {
		checkName(name, call, 'setting name');
		const row = (value as Record<string, unknown>)[name];
		if (typeof row !== 'object' || row === null || Array.isArray(row))
			throw invalid(
				call,
				`got ${JSON.stringify(row)} for the setting '${name}'; give it presets, values and a governor.`,
			);
		const unknown = Object.keys(row).find((key) => !SETTING_TAKES.has(key));
		if (unknown !== undefined)
			throw invalid(
				call,
				`got the option '${unknown}' for the setting '${name}'; a setting takes ${choices([...SETTING_TAKES])}.`,
			);
		const values = checkSettingValues((row as { values?: unknown }).values, call, name);
		const presets = checkPresets(
			(row as { presets?: unknown }).presets,
			values,
			call,
			`presets of the setting '${name}'`,
		);
		const webgl2 = (row as { webgl2?: unknown }).webgl2;
		const governor =
			(row as { governor?: unknown }).governor === undefined
				? 'none'
				: checkOne(
						(row as { governor?: unknown }).governor,
						GOVERNORS,
						call,
						`governor of the setting '${name}'`,
					);
		if (governor !== 'none' && !hasBudget)
			throw invalid(
				call,
				`got the governor '${governor}' for the setting '${name}' without a budget; the budget's steps are what reach a setting. Give the feature a budget.`,
			);
		out[name] = Object.freeze({
			presets,
			values,
			governor,
			...(webgl2 === undefined
				? {}
				: {
						webgl2: checkPresets(webgl2, values, call, `WebGL2 presets of the setting '${name}'`),
					}),
		});
	}
	return Object.freeze(out);
}

/** The budget that `value` declares, or throws E1223. */
function checkBudget(value: unknown, call: string): FeatureBudget | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw invalid(call, `got the budget ${JSON.stringify(value)}; give it presets and a minimum.`);
	const budget = value as { presets?: unknown; min?: unknown; [key: string]: unknown };
	const unknown = Object.keys(budget).find((key) => key !== 'presets' && key !== 'min');
	if (unknown !== undefined)
		throw invalid(call, `got the budget option '${unknown}'; a budget takes presets and min.`);
	const presets = budget.presets;
	if (!Array.isArray(presets) || presets.length !== 4)
		throw invalid(
			call,
			`got the budget's presets ${JSON.stringify(presets)}; give the time in ms at full quality on each preset, from Low to Ultra: four values.`,
		);
	for (const ms of presets)
		if (typeof ms !== 'number' || !(ms > 0) || !Number.isFinite(ms))
			throw invalid(
				call,
				`got the budget's time ${JSON.stringify(ms)}; give a number of ms above 0 on each preset.`,
			);
	const min = budget.min ?? 0;
	if (typeof min !== 'number' || !(min >= 0 && min <= 1))
		throw invalid(call, `got the budget's min ${JSON.stringify(min)}; give a number from 0 to 1.`);
	return Object.freeze({
		presets: Object.freeze([...presets]) as unknown as readonly [number, number, number, number],
		min,
	});
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
	readonly debugViews: readonly FeatureDebugView[];
	readonly views: readonly FeatureView[];
	readonly settings: Readonly<Record<string, FeatureSetting>>;
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
	const debugViews = checkDebugViews(description.debugViews, call);
	const views = checkList(description.views, VIEWS, call, 'view', 'views');
	const outputs = checkOutputs(description.outputs, call);
	const budget = checkBudget(description.budget, call);
	const settings = checkSettings(description.settings, call, budget !== undefined);
	checkCallback(description.ready, call, 'ready');
	checkCallback(description.quality, call, 'quality');
	checkCallback(description.memory, call, 'memory');
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
		debugViews,
		settings,
		...(budget === undefined ? {} : { budget }),
		...(description.ready === undefined ? {} : { ready: description.ready }),
		...(description.quality === undefined ? {} : { quality: description.quality }),
		...(description.memory === undefined ? {} : { memory: description.memory }),
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
 * outside its band, an unknown resource, slot or view, an output with no neutral default, a setting
 * with a value outside its own range or a governor without a budget, or a budget whose presets are
 * not four times above 0.
 *
 * @category api/features
 */
export function defineFeature(description: FeatureDescription): FeatureDescription {
	return normalize(description, 'defineFeature');
}

/** True when a setting's values are whole numbers, which a scaled value rounds to. */
function wholeValues(values: SettingValues): boolean {
	if (values === 'flag') return false;
	if (!('min' in values)) return values.every((value) => Number.isInteger(value));
	return values.whole === true;
}

/**
 * The value of a feature's setting on `preset` and the GPU path `tier`, before the governor's
 * steps: the row's WebGL2 value where WebGL2 gives one, and the row's own value otherwise.
 */
export function featureSettingValue(
	setting: FeatureSetting,
	preset: QualityPreset,
	tier?: Tier,
): FeatureValue {
	const values = (tier === 'webgl2' && setting.webgl2) || setting.presets;
	return values[presetIndex(preset)] as FeatureValue;
}

/**
 * The value that `setting` gives while the governor's budget scale is `scale`, from `base`, the
 * value of the preset in use. A `'scale'` setting takes the budget's share of its value, which
 * costs that share of the work, and rounds where its values are whole numbers. A `'double'`
 * setting doubles its value for each step taken, up to the highest value of its range. Any other
 * setting keeps its value.
 */
export function governedValue(
	setting: FeatureSetting,
	base: FeatureValue,
	scale: number,
): FeatureValue {
	if (setting.governor === undefined || setting.governor === 'none') return base;
	if (typeof base !== 'number' || scale >= 1) return base;
	const steps = Math.round((1 - scale) * BUDGET_STEPS);
	if (setting.governor === 'scale') {
		const scaled = base * scale;
		return wholeValues(setting.values) ? Math.round(scaled) : scaled;
	}
	const doubled = base * 2 ** steps;
	const { values } = setting;
	if (typeof values !== 'string' && 'min' in values) return Math.min(values.max, doubled);
	return doubled;
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
	/** The feature that adds each debug view. */
	private readonly debugViews = new Map<string, string>();

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
		for (const view of feature.debugViews) {
			const owner = this.debugViews.get(view.name);
			if (owner !== undefined)
				throw invalid(
					call,
					`got the debug view '${view.name}', which the feature '${owner}' adds already. Give each view a name of its own.`,
				);
		}
		this.descriptions.set(feature.name, feature);
		for (const name of Object.keys(feature.outputs)) this.outputs.set(name, feature.name);
		for (const slot of feature.provides) this.slots.set(slot, feature.name);
		for (const view of feature.debugViews) this.debugViews.set(view.name, feature.name);
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
		for (const view of feature.debugViews) this.debugViews.delete(view.name);
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
