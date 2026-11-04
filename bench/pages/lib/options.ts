// The address switches that benchmark pages share. Each check fails with a message that says how to
// fix the address, and the page publishes that message as its error.

import { HOLD_TIME, MEASURE_SECONDS, WARMUP_SECONDS } from '../../scenes/spec';

export interface RunOptions {
	/**
	 * `?hold`: render one frame and publish its pixels, instead of a timed run. The value is the
	 * scene time to draw: `?hold=3.5`, or the scene module's hold time for a bare `?hold`. Null
	 * without the switch.
	 */
	hold: number | null;
	/** `?demo`: run the scene until the page closes, with no measurement. */
	demo: boolean;
	/**
	 * `?keep`: run the scene as a timed run does, without the demo's controls, until the page closes,
	 * with no measurement.
	 */
	keep: boolean;
	/** `?n=`: the instance count, or null to use the scene's default. */
	count: number | null;
	/** The warm-up of a timed run: `?seconds=`, or the protocol's without the switch. */
	warmupSeconds: number;
	/**
	 * The measured time of a timed run: `?measure=`, or else `?seconds=`, or the protocol's. A run
	 * that must count more frames measures longer without warming up longer.
	 */
	measureSeconds: number;
	/**
	 * `?soak=`: minutes to run the scene, measured once a minute, instead of a timed run, or null
	 * without the switch.
	 */
	soak: number | null;
	/**
	 * `?shadows=`: the sun's shadow cascades, from 1 to 4, in the scenes that draw shadows, or null
	 * for no shadows. three.js draws one shadow map whatever the count.
	 */
	shadows: number | null;
	/**
	 * `?far=`: the frames between two draws of a far shadow cascade, from 1 to 8, in the scenes that
	 * draw shadows, or null for the quality preset's.
	 */
	far: number | null;
	/**
	 * `?shadowCascades=`, `?shadowMapSize=` and `?shadowFilter=`: quality settings that replace the
	 * preset's on a null3D page, such as a candidate preset's values on a phone, or null to keep the
	 * preset's. The engine checks each value.
	 */
	shadowCascades: number | null;
	shadowMapSize: number | null;
	shadowFilter: number | null;
	/**
	 * `?shadowCascadeBlend=`: the share of each shadow cascade that blends into the next, from 0 to
	 * 0.5, to measure what the band costs, or null for the preset's.
	 */
	shadowCascadeBlend: number | null;
	/**
	 * `?antialias=`: how a null3D page smooths edges, `none`, `fxaa` or `msaa`, in place of the
	 * preset's, to measure what each mode costs, or null for the preset's.
	 */
	antialias: 'none' | 'fxaa' | 'msaa' | null;
	/**
	 * `?cloudSteps=`: the steps of each ray of the sky's volumetric cloud tier, from 0 to 64, 0 for
	 * the flat layer, in place of the preset's, or null for the preset's. The image tests pin it to 0
	 * on the software renderer, which cannot afford the march.
	 */
	cloudSteps: number | null;
	/**
	 * `?maxPixelRatio=`: the highest pixel ratio that a null3D page draws at, in place of the preset's
	 * cap on a page that fills the window and the protocol's on one that does not, or null for those.
	 */
	maxPixelRatio: number | null;
	/**
	 * False with `?governor=off`, which keeps the quality governor off in a null3D scene that turns
	 * it on, such as S4, so that a comparison of two builds measures the same work in every run.
	 */
	governor: boolean;
	/**
	 * `?renderScale=`: the render scale that a null3D scene holds, between 0.25 and 1, or null for
	 * the preset's range and the governor's steps. A reading that names one scale's cost pins it,
	 * so no step can move it under the reading.
	 */
	renderScale: number | null;
}

/** The value of a switch that must be one of a few words, or `fallback` when the address has none. */
export function readChoice<T extends string>(
	params: URLSearchParams,
	name: string,
	choices: readonly T[],
	fallback?: T,
): T {
	const value = params.get(name);
	if (value === null && fallback !== undefined) return fallback;
	const choice = choices.find((c) => c === value);
	if (choice === undefined) {
		const options = choices.map((c) => `?${name}=${c}`).join(' or ');
		throw new Error(
			value === null
				? `Add ${options} to the page address.`
				: `"${value}" is not a valid ${name}. Use ${options}.`,
		);
	}
	return choice;
}

function readNumber(
	params: URLSearchParams,
	name: string,
	valid: (value: number) => boolean,
	expected: string,
): number | null {
	const text = params.get(name);
	if (text === null) return null;
	const value = Number(text);
	if (text.trim() === '' || !valid(value)) {
		throw new Error(`?${name}=${text} is not valid: use ${expected}, for example ?${name}=2.`);
	}
	return value;
}

/**
 * The name a page publishes its result under: `hold`, `demo` (also for `?keep`), `soak` or `bench`.
 */
export function pageReport(params: URLSearchParams): 'hold' | 'demo' | 'soak' | 'bench' {
	if (params.has('hold')) return 'hold';
	if (params.has('demo') || params.has('keep')) return 'demo';
	return params.has('soak') ? 'soak' : 'bench';
}

/** A whole number that the engine checks itself. */
const whole = (v: number) => Number.isSafeInteger(v) && v > 0;

/**
 * Reads `?hold`, `?demo`, `?keep`, `?n=`, `?seconds=`, `?measure=`, `?soak=`, `?shadows=`, `?far=`,
 * `?governor=`, `?renderScale=`, the shadow quality settings, `?antialias=`, `?cloudSteps=` and
 * `?maxPixelRatio=`.
 */
export function readRunOptions(params: URLSearchParams): RunOptions {
	const seconds = (name: string) =>
		readNumber(params, name, (v) => Number.isFinite(v) && v > 0, 'a number of seconds above 0');
	const both = seconds('seconds');
	return {
		hold:
			params.get('hold') === ''
				? HOLD_TIME
				: readNumber(
						params,
						'hold',
						(v) => Number.isFinite(v) && v >= 0,
						'a scene time in seconds, 0 or more',
					),
		demo: params.has('demo'),
		keep: params.has('keep'),
		count: readNumber(
			params,
			'n',
			(v) => Number.isSafeInteger(v) && v > 0,
			'a whole number above 0',
		),
		warmupSeconds: both ?? WARMUP_SECONDS,
		measureSeconds: seconds('measure') ?? both ?? MEASURE_SECONDS,
		soak: readNumber(
			params,
			'soak',
			(v) => Number.isInteger(v) && v >= 1,
			'a whole number of minutes, 1 or more',
		),
		shadows: readNumber(
			params,
			'shadows',
			(v) => Number.isInteger(v) && v >= 1 && v <= 4,
			'a cascade count from 1 to 4',
		),
		far: readNumber(
			params,
			'far',
			(v) => Number.isInteger(v) && v >= 1 && v <= 8,
			'a whole number of frames from 1 to 8',
		),
		shadowCascades: readNumber(params, 'shadowCascades', whole, 'a cascade count from 1 to 4'),
		shadowMapSize: readNumber(params, 'shadowMapSize', whole, 'a size such as 2048'),
		shadowFilter: readNumber(params, 'shadowFilter', whole, 'a filter size of 3 or 5'),
		shadowCascadeBlend: readNumber(
			params,
			'shadowCascadeBlend',
			(v) => Number.isFinite(v) && v >= 0 && v <= 0.5,
			'a share from 0 to 0.5',
		),
		antialias: params.has('antialias')
			? readChoice(params, 'antialias', ['none', 'fxaa', 'msaa'] as const)
			: null,
		cloudSteps: readNumber(
			params,
			'cloudSteps',
			(v) => Number.isInteger(v) && v >= 0 && v <= 64,
			'a whole step count from 0 to 64',
		),
		maxPixelRatio: readNumber(
			params,
			'maxPixelRatio',
			(v) => Number.isFinite(v) && v >= 0.5,
			'a pixel ratio of 0.5 or more',
		),
		governor: !params.has('governor') || readChoice(params, 'governor', ['off']) !== 'off',
		renderScale: readNumber(
			params,
			'renderScale',
			(v) => Number.isFinite(v) && v >= 0.25 && v <= 1,
			'a scale from 0.25 to 1, such as 0.5',
		),
	};
}

/**
 * The engine options that a page's switches set, for `createEngine`. Every switch that names a
 * quality setting is forwarded here, so a page that builds its engine options with this function
 * cannot drop one. `maxPixelRatio` is the page's, because a page that fills its window caps a
 * pixel ratio the protocol's canvas does not. The governor and the render scale reach the sketch,
 * which applies them to the engine's quality settings.
 */
export function engineOptionsOf(options: RunOptions) {
	return {
		...(options.antialias !== null && { antialias: options.antialias }),
		...(options.cloudSteps !== null && { cloudSteps: options.cloudSteps }),
		...(options.shadowCascades !== null && { shadowCascades: options.shadowCascades }),
		...(options.shadowMapSize !== null && { shadowMapSize: options.shadowMapSize }),
		...(options.shadowCascadeBlend !== null && {
			shadowCascadeBlend: options.shadowCascadeBlend,
		}),
	};
}
