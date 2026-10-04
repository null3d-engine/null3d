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
	// The texels on each side of the square that blends each shadow's edge. The shaders read it
	// from a uniform, so it changes during play with no new pipeline. Tablets draw at a pixel ratio
	// of 2, where the smaller square's edges look jagged, so Medium takes the larger one too.
	shadowFilter: {
		presets: [3, 5, 5, 5],
		changes: 'live',
		values: [3, 5],
	},
	// The frames between two draws of each far shadow cascade. The nearest cascade draws in every
	// frame, and a far cascade keeps its layer of the shadow map in between.
	farCascadeInterval: {
		presets: [4, 3, 2, 2],
		changes: 'live',
		values: { min: 1, max: 8, whole: true, heavierBelow: true },
	},
	// The share of three.js's taps that each of bloom's blurs reads: 1 reads them all, and 0.5 or
	// 0.25 spread the same kernel over half or a quarter as many filtered reads, which costs less
	// and keeps the glow's size. The shaders read it from a uniform, so it changes during play with
	// no new pipeline. Every preset keeps three.js's taps until device runs measure bloom's cost.
	bloomSamples: {
		presets: [1, 1, 1, 1],
		changes: 'live',
		values: [0.25, 0.5, 1],
	},
	// The size of ambient occlusion's targets, as a share of the render size each way: half on High
	// and Ultra, and 0 on Low and Medium, where ambient occlusion draws nothing even when the sketch
	// turns it on. A share above 0 draws a corner of the same targets, so it changes during play
	// with no new GPU object; a change to or from 0 adds or removes its passes, as `post.set` does.
	aoScale: {
		presets: [0, 0, 0.5, 0.5],
		changes: 'live',
		values: [0, 0.25, 0.5],
	},
	// Software occlusion culling on WebGL2: the job workers draw the objects marked as blockers
	// into a small depth buffer, and hide what lies wholly behind them. Its cost on phones is not
	// measured yet, so these values follow the plan until device runs settle them (D-41).
	softwareOcclusion: {
		presets: [false, true, true, true],
		changes: 'live',
		values: 'flag',
	},
	// The frame-budget governor (governor.ts), which lowers the live settings above when frames take
	// too long and raises them again when they have time to spare.
	governor: {
		presets: [true, true, true, true],
		changes: 'live',
		values: 'flag',
	},
	// FXAA on Low, which phones draw: MSAA's samples cost them more memory traffic.
	antialias: {
		presets: ['fxaa', 'msaa', 'msaa', 'msaa'],
		changes: 'start',
		values: ['none', 'fxaa', 'msaa'],
	},
	// The cascades of a directional light's shadows, and the texels on each side of each cascade's
	// layer of the shadow map, for each light that names neither. A light takes them when it is
	// created, and the shadow map's size follows from them. One cascade spreads its texels over the
	// whole shadow distance, which blurs the near shadows, so Low keeps two. Medium keeps three,
	// as two make the near shadows coarser on a tablet's sharp screen.
	shadowCascades: {
		presets: [2, 3, 3, 4],
		changes: 'start',
		values: { min: 1, max: 4, whole: true },
	},
	shadowMapSize: {
		presets: [1024, 2048, 2048, 4096],
		changes: 'start',
		values: [512, 1024, 2048, 4096],
	},
	// The tiles of the shadow atlas that spot and point lights cast their shadows into: a spot light
	// takes one, and a point light six. The lights that look largest from the camera get them
	// first. 0 turns their shadows off. The atlas grows to the layers that the lights fill, and
	// keeps them while some light casts.
	shadowTiles: {
		presets: [4, 8, 16, 24],
		changes: 'start',
		values: { min: 0, max: 24, whole: true },
	},
	// Texels on each side of each tile of the shadow atlas. A tile takes 4 bytes per texel.
	shadowTileSize: {
		presets: [512, 512, 1024, 1024],
		changes: 'start',
		values: [256, 512, 1024, 2048],
	},
	// Point lights cast shadows into six tiles each, so only the heavier presets turn them on.
	pointLightShadows: {
		presets: [false, false, true, true],
		changes: 'start',
		values: 'flag',
	},
	// The depth prepass trades a second pass over the opaque objects' vertices for shading each
	// pixel once. It stays off on every preset: it made S2's GPU time per frame 45% longer on the
	// Mac (Benchmarks, "The depth prepass").
	depthPrepass: {
		presets: [false, false, false, false],
		changes: 'start',
		values: 'flag',
	},
	// The most morph weights of each object that WebGL2 draws. Its vertex shaders morph in every
	// pass that draws a mesh, shadow passes too, and skip a target whose weight is 0, so the cap
	// bounds the reads of each pass. WebGPU morphs once per frame in its skinning pass and draws
	// every weight. Low keeps three.js's old limit of 8 active targets.
	morphTargets: {
		presets: [8, 16, 32, 64],
		changes: 'start',
		values: { min: 1, max: 256, whole: true },
	},
	// The shared memory's maximum, from 256 MiB to the 4 GiB that the threaded core declares. Every
	// preset keeps the loader's default (D-04). A phone filled the whole 4 GiB in one tab; the
	// tablet's limit is not measured yet, and may lower the lighter presets' values (D-12).
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
	 * The texels on each side of the square of shadow map texels that blend into each point's
	 * shadow: 3 or 5. A larger square gives softer shadow edges and costs more per pixel that
	 * receives shadows. It changes during play.
	 */
	shadowFilter: 3 | 5;
	/**
	 * How often each far shadow cascade draws: once in this many frames, a whole number from 1 to
	 * 8. The nearest cascade draws in every frame, and the far ones take turns. A far cascade that a
	 * dynamic object touches draws in every frame, so moving shadows follow their casters. A higher
	 * value costs less where far cascades hold still casters alone. It changes during play.
	 */
	farCascadeInterval: number;
	/**
	 * The share of three.js's `UnrealBloomPass` taps that each of bloom's blurs reads: 1, 0.5 or
	 * 0.25. A lower share spreads the same blur over fewer reads, which costs less and keeps the
	 * glow's size, with coarser steps in it. It changes during play.
	 */
	bloomSamples: 0.25 | 0.5 | 1;
	/**
	 * The size of ambient occlusion's targets, as a share of the render size each way: 0.5, 0.25,
	 * or 0, which draws no ambient occlusion even when `post.set` turns it on. A smaller share costs
	 * less, with softer occlusion. It changes during play: 0.5 and 0.25 make no GPU object, and a
	 * change to or from 0 adds or removes ambient occlusion's passes.
	 */
	aoScale: 0 | 0.25 | 0.5;
	/**
	 * Whether the frame-budget governor runs. When frames take too long, it lowers the render scale
	 * toward `minRenderScale`, then how often far shadow cascades draw, then the shadow filter, then
	 * bloom's samples while bloom is on, then ambient occlusion's scale while it draws. It raises them again, in the reverse order, once frames
	 * have time to spare. `quality.governor` reports its steps. False keeps the render scale at
	 * `maxRenderScale` and the other settings as set, as benchmarks and captures need. It changes
	 * during play.
	 */
	governor: boolean;
	/**
	 * How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa`
	 * smooths edges in the final pass, and `none` leaves them sharp. The mode is fixed when the
	 * engine starts: the page's `antialias` option of `createEngine` sets it, and `set` does not
	 * take it.
	 */
	antialias: 'none' | 'fxaa' | 'msaa';
	/**
	 * The cascades of a directional light's shadows, a whole number from 1 to 4, for each light whose
	 * `shadow` options name none. More cascades keep shadows sharp further from the camera, and each
	 * draws the shadow casters once more. The `shadowCascades` option of `createEngine` sets it, and
	 * `set` does not take it.
	 */
	shadowCascades: number;
	/**
	 * Texels on each side of each cascade's shadow map, for each directional light whose `shadow`
	 * options name no `mapSize`: 512, 1,024, 2,048 or 4,096. A larger map gives sharper shadow edges
	 * and takes more memory, 4 bytes per texel in each cascade. The `shadowMapSize` option of
	 * `createEngine` sets it, and `set` does not take it.
	 */
	shadowMapSize: number;
	/**
	 * The most tiles of the shadow atlas, which spot and point lights cast their shadows into: a
	 * spot light takes one tile. When more lights cast shadows than the tiles hold, the lights that
	 * look largest from the camera get them. It takes a whole number from 0, which turns the
	 * shadows of spot and point lights off, to 24. The `shadowTiles` option of `createEngine` sets
	 * it, and `set` does not take it.
	 */
	shadowTiles: number;
	/**
	 * Texels on each side of each tile of the shadow atlas: 256, 512, 1,024 or 2,048. Larger tiles
	 * give sharper shadows and take more memory, 4 bytes per texel. The `shadowTileSize` option of
	 * `createEngine` sets it, and `set` does not take it.
	 */
	shadowTileSize: number;
	/**
	 * True when point lights cast shadows. Each point light that casts them takes six tiles of the
	 * shadow atlas, one for each face of a cube around it, within `shadowTiles`. The
	 * `pointLightShadows` option of `createEngine` sets it, and `set` does not take it.
	 */
	pointLightShadows: boolean;
	/**
	 * True when the engine draws the depth of the opaque objects before it shades them, so it
	 * shades each pixel once, for its nearest surface. The setting is fixed when the engine starts:
	 * the page's `depthPrepass` option of `createEngine` sets it, and `set` does not take it.
	 */
	depthPrepass: boolean;
	/**
	 * The most morph target weights of each object that a WebGL2 device draws, a whole number from
	 * 1 to 256. Each object keeps the weights farthest from 0, and draws the others as 0. WebGPU
	 * draws every weight. The `morphTargets` option of `createEngine` sets it, and `set` does not
	 * take it.
	 */
	morphTargets: number;
	/**
	 * True when software occlusion culling runs on WebGL2: each frame, the job workers draw the
	 * objects that `setOccluder(true)` marks into a small depth buffer, and the engine skips every
	 * object that lies wholly behind them. It costs the job workers time for each blocker, and
	 * saves drawing what they hide. It changes during play. WebGPU ignores it.
	 */
	softwareOcclusion: boolean;
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

/** The settings in `settings` that a sketch reads but cannot change during play. */
export function startValues(settings: QualitySettings): Partial<QualitySettings> {
	const values: Record<string, unknown> = {};
	const all = settings as unknown as Record<string, unknown>;
	for (const name of SKETCH_SETTINGS) if (!LIVE_SETTINGS.includes(name)) values[name] = all[name];
	return values as Partial<QualitySettings>;
}

/**
 * The settings of a start on `from` that the preset check lowered to `to`: `to`'s values for the
 * settings that change during play, and `from`'s for those fixed at the start, with the values in
 * `options` where the page's options give them. These are the settings that the check's steps
 * leave, so a start that reuses an earlier check runs them from its first frame.
 */
export function checkedSettings(
	from: QualityPreset,
	to: QualityPreset,
	options: Partial<QualitySettings> = {},
): QualitySettings {
	const start = presetSettings(from, options);
	return to === from ? start : presetSettings(to, { ...options, ...startValues(start) });
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
