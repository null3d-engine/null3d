// The quality presets as one table of the settings that the engine applies, with a value for each
// preset. The page chooses a preset when the engine starts (chooser.ts), and each setting starts
// at that preset's value. Each setting says when it can change and which values it takes. The
// settings of features that are not built yet keep their planned values in preset-docs.ts, with
// every setting's docs text. Only the docs generator and the tests import that file, so the
// engine's files carry neither. A feature moves its row from there into this table when it
// applies the setting. A setting that a sketch reads is also a member of QualitySettings, and a
// test keeps the two lists equal. A sketch changes only the settings that change during play.

import { EngineError } from '../errors/engine-error';

/** Bytes in a mebibyte. */
export const MIB = 1024 * 1024;

/**
 * A quality preset: `low`, `medium`, `high` or `ultra`, from the lightest to the heaviest. Each
 * preset gives every quality setting a value, and the engine starts with the values of the preset
 * it runs.
 *
 * @category api/quality
 */
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

/** The presets from the lightest to the heaviest. */
export const QUALITY_PRESETS = [
	'low',
	'medium',
	'high',
	'ultra',
] as const satisfies readonly QualityPreset[];

/**
 * When a setting can change: `live` during play, `start` only when the preset starts, and `load`
 * only before the engine loads, as the engine's memory is fixed then.
 */
export type SettingChange = 'live' | 'start' | 'load';

/**
 * The values a setting takes: a range of numbers, `flag` for true or false, or a list of choices
 * from the lightest to the heaviest. A range costs more at higher values, or at lower values with
 * `heavierBelow`, as an update interval does.
 */
export type SettingValues =
	| { min: number; max: number; whole?: boolean; heavierBelow?: boolean }
	| 'flag'
	| readonly (string | number)[];

/** A row of the preset table. */
export interface Setting {
	/** The value on each preset, from Low to Ultra. */
	presets: readonly [unknown, unknown, unknown, unknown];
	changes: SettingChange;
	values: SettingValues;
}

/**
 * The settings that the engine applies, with their value on each preset. The values are starting
 * points, which measurements on phones, tablets and desktops tune.
 */
export const QUALITY_SETTINGS = {
	maxPixelRatio: {
		presets: [1.5, 2, 2, Number.POSITIVE_INFINITY],
		changes: 'live',
		values: { min: 0.5, max: Number.POSITIVE_INFINITY },
	},
	// The range of the render scale, the part of the canvas's width and height that the scene draws
	// at. Dynamic resolution moves the scale within it (resolution.ts).
	minRenderScale: {
		presets: [0.5, 0.6, 0.75, 1],
		changes: 'live',
		values: { min: 0.25, max: 1 },
	},
	maxRenderScale: {
		presets: [1, 1, 1, 1],
		changes: 'live',
		values: { min: 0.25, max: 1 },
	},
	// The highest anisotropy that texture samplers use. WebGPU samplers take at most 16. A change
	// makes the samplers and their bind groups again, and no pipeline.
	maxAnisotropy: {
		presets: [2, 4, 8, 16],
		changes: 'live',
		values: { min: 1, max: 16, whole: true },
	},
	// The texel bytes that one frame may upload, so a scene that loads many textures spreads them
	// over frames.
	uploadBytesPerFrame: {
		presets: [2 * MIB, 4 * MIB, 8 * MIB, 16 * MIB],
		changes: 'live',
		values: { min: 64 * 1024, max: 64 * MIB, whole: true },
	},
	// FXAA on Low, which phones draw: MSAA's samples cost them more memory traffic.
	antialias: {
		presets: ['fxaa', 'msaa', 'msaa', 'msaa'],
		changes: 'start',
		values: ['none', 'fxaa', 'msaa'],
	},
	// The depth prepass trades a second pass over the opaque objects' vertices for shading each
	// pixel once. It stays off on every preset until S2's GPU time with and without it, on desktops,
	// tablets and phones, shows where it pays.
	depthPrepass: {
		presets: [false, false, false, false],
		changes: 'start',
		values: 'flag',
	},
	// The shared memory's maximum, from 256 MiB to the 4 GiB that the threaded core declares. Every
	// preset keeps the loader's default until measurements of the memory that tabs can use on
	// phones and tablets set one per preset (D-04).
	memoryMaximumMiB: {
		presets: [1024, 1024, 1024, 1024],
		changes: 'load',
		values: { min: 256, max: 4096, whole: true },
	},
} as const satisfies Record<string, Setting>;

/** The name of a setting that the engine applies. */
export type QualitySettingName = keyof typeof QUALITY_SETTINGS;

/** A setting's value type, from its values on the presets. */
export type SettingValue<K extends QualitySettingName> =
	(typeof QUALITY_SETTINGS)[K]['presets'][number];

/**
 * The quality settings that a sketch reads and changes through `ctx.quality`. Each starts at the
 * value of the preset that the engine runs, or at the value of the page's `createEngine` option
 * for the setting.
 *
 * @category api/quality
 */
export interface QualitySettings {
	/**
	 * The highest device pixel ratio that the engine draws at. The canvas's drawing buffer is its
	 * CSS size times the lower of this and the screen's pixel ratio. `Infinity` draws at the
	 * screen's full ratio. It takes a number from 0.5 up, and changes during play: the canvas takes
	 * its new size within a frame or two.
	 */
	maxPixelRatio: number;
	/**
	 * The lowest render scale: the smallest part of the canvas's width and height that the scene
	 * draws at when frames take too long. The engine draws the scene at a render scale between this
	 * and `maxRenderScale`, and scales the image up to the canvas. It takes a number from 0.25 to
	 * 1, at most `maxRenderScale`, and changes during play. 1 keeps the whole canvas.
	 */
	minRenderScale: number;
	/**
	 * The highest render scale, where the engine starts. It takes a number from 0.25 to 1, and
	 * changes during play. With `minRenderScale` at the same value, the scene always draws at that
	 * scale.
	 */
	maxRenderScale: number;
	/**
	 * The highest anisotropy that textures sample with. A texture whose own `anisotropy` option is
	 * higher samples at this value. It takes a whole number from 1 to 16, and changes during play.
	 */
	maxAnisotropy: number;
	/**
	 * The texel bytes that one frame may upload, so that loading many textures does not make one
	 * frame slow. A larger texture goes up in bands of rows over several frames. It takes a whole
	 * number from 65,536 (64 KiB) to 67,108,864 (64 MiB), and changes during play.
	 */
	uploadBytesPerFrame: number;
	/**
	 * How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa`
	 * smooths edges in the final pass, and `none` leaves them sharp. The mode is fixed when the
	 * engine starts: the page's `antialias` option of `createEngine` sets it, and `set` does not
	 * take it.
	 */
	antialias: 'none' | 'fxaa' | 'msaa';
	/**
	 * True when the engine draws the depth of the opaque objects before it shades them, so it
	 * shades each pixel once, for its nearest surface. The setting is fixed when the engine starts:
	 * the page's `depthPrepass` option of `createEngine` sets it, and `set` does not take it. It is
	 * always false on WebGL2, which draws without the prepass.
	 */
	depthPrepass: boolean;
}

/** The names of the settings in the preset table that change as `changes` says. */
function settingsThatChange(changes: (change: SettingChange) => boolean): QualitySettingName[] {
	return (Object.keys(QUALITY_SETTINGS) as QualitySettingName[]).filter((name) =>
		changes(QUALITY_SETTINGS[name].changes),
	);
}

/**
 * The settings that a sketch reads: those that are fixed only after the load. `quality.setPreset`
 * gives them the new preset's values.
 */
export const SKETCH_SETTINGS: readonly QualitySettingName[] = settingsThatChange(
	(change) => change !== 'load',
);

/** The settings that a sketch changes: those that change during play. */
export const LIVE_SETTINGS: readonly QualitySettingName[] = settingsThatChange(
	(change) => change === 'live',
);

/** A preset's place in the order, from 0 for Low to 3 for Ultra. */
export function presetIndex(preset: QualityPreset): number {
	return QUALITY_PRESETS.indexOf(preset);
}

/** `preset` lowered by `steps`, down to Low at most. */
export function lowered(preset: QualityPreset, steps: number): QualityPreset {
	return QUALITY_PRESETS[Math.max(0, presetIndex(preset) - steps)] ?? 'low';
}

/** A setting's value on a preset. */
export function presetValue<K extends QualitySettingName>(
	name: K,
	preset: QualityPreset,
): SettingValue<K> {
	return QUALITY_SETTINGS[name].presets[presetIndex(preset)] as SettingValue<K>;
}

/**
 * The settings that a sketch starts with on `preset`: the preset's values, and the values in
 * `options` where the page's options give them.
 */
export function presetSettings(
	preset: QualityPreset,
	options: Partial<QualitySettings> = {},
): QualitySettings {
	const settings: Record<string, unknown> = {};
	for (const name of SKETCH_SETTINGS)
		settings[name] = (options as Record<string, unknown>)[name] ?? presetValue(name, preset);
	return settings as unknown as QualitySettings;
}

/** "a, b or c", for the choices in an error message. */
function listOf(items: readonly string[]): string {
	return items.length < 2
		? (items[0] ?? '')
		: `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** A value as an error message quotes it. */
const quoted = (value: unknown) => (typeof value === 'string' ? `"${value}"` : String(value));

/** The values a setting takes, in words: "a number from 0.5 up", "'none', 'fxaa' or 'msaa'". */
export function describeValues(values: SettingValues): string {
	if (values === 'flag') return 'true or false';
	if ('min' in values) {
		const kind = values.whole ? 'a whole number' : 'a number';
		return values.max === Number.POSITIVE_INFINITY
			? `${kind} from ${values.min} up`
			: `${kind} from ${values.min} to ${values.max}`;
	}
	return listOf(values.map((value) => (typeof value === 'string' ? `'${value}'` : String(value))));
}

/** True when a setting with these values takes `value`. */
export function takesValue(values: SettingValues, value: unknown): boolean {
	if (values === 'flag') return typeof value === 'boolean';
	if ('min' in values)
		return (
			typeof value === 'number' &&
			value >= values.min &&
			value <= values.max &&
			(!values.whole || Number.isInteger(value))
		);
	return (values as readonly unknown[]).includes(value);
}

/**
 * Checks the settings that `call` got, which takes the settings in `names`. Each must be one of
 * them, with a value that the setting takes. Throws E1213 at the first that is not. A setting given
 * as undefined counts as absent.
 */
export function checkSettings(
	call: string,
	settings: object,
	names: readonly QualitySettingName[] = SKETCH_SETTINGS,
): void {
	if (typeof settings !== 'object' || settings === null)
		throw new EngineError(
			'E1213',
			`${call} got ${quoted(settings)}, which is not an object of settings.`,
		);
	for (const [name, value] of Object.entries(settings)) {
		if (value === undefined) continue;
		if (!(names as readonly string[]).includes(name))
			throw new EngineError(
				'E1213',
				QUALITY_SETTINGS[name as QualitySettingName]?.changes === 'start'
					? `${call} got ${name}, which is fixed when the engine starts. Set it with the ${name} option of createEngine().`
					: `${call} got "${name}", which is not a setting it takes. It takes ${listOf(names)}.`,
			);
		const { values } = QUALITY_SETTINGS[name as QualitySettingName];
		if (!takesValue(values, value))
			throw new EngineError(
				'E1213',
				`${call} got ${name} ${quoted(value)}, which is not ${describeValues(values)}.`,
			);
	}
}

/** `value` when it is one of `names`; otherwise throws E1213, which names the `call` that got it. */
function namedPreset<T extends string>(call: string, value: unknown, names: readonly T[]): T {
	if ((names as readonly unknown[]).includes(value)) return value as T;
	throw new EngineError(
		'E1213',
		`${call} got the preset ${quoted(value)}, which is not ${listOf(names.map((name) => `'${name}'`))}.`,
	);
}

/**
 * The preset that `createEngine`'s option names, `auto` when it names none. Throws E1213 when it
 * names no preset.
 */
export function presetOption(value: unknown): QualityPreset | 'auto' {
	return value === undefined
		? 'auto'
		: namedPreset('createEngine()', value, ['auto', ...QUALITY_PRESETS] as const);
}

/** The preset that `quality.setPreset` got. Throws E1213 when it names no preset. */
export function presetArgument(value: unknown): QualityPreset {
	return namedPreset('quality.setPreset()', value, QUALITY_PRESETS);
}
