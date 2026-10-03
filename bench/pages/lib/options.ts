// The address switches that benchmark pages share. Each check fails with a message that says how to
// fix the address, and the page publishes that message as its error.

import { HOLD_TIME } from '../../scenes/spec';

export interface RunOptions {
	/**
	 * `?hold`: render one frame and publish its pixels, instead of a timed run. The value is the
	 * scene time to draw: `?hold=3.5`, or the scene module's hold time for a bare `?hold`. Null
	 * without the switch.
	 */
	hold: number | null;
	/** `?demo`: run the scene until the page closes, with no measurement. */
	demo: boolean;
	/** `?n=`: the instance count, or null to use the scene's default. */
	count: number | null;
	/** `?seconds=`: the warm-up and the measured time of a run, or null to use the protocol's. */
	seconds: number | null;
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
	 * `?shadowCascades=`, `?shadowMapSize=` and `?shadowFilter=`: quality settings that replace the
	 * preset's on a null3D page, such as a candidate preset's values on a phone, or null to keep the
	 * preset's. The engine checks each value.
	 */
	shadowCascades: number | null;
	shadowMapSize: number | null;
	shadowFilter: number | null;
	/**
	 * False with `?governor=off`, which keeps the quality governor off in a null3D scene that turns
	 * it on, such as S4, so that a comparison of two builds measures the same work in every run.
	 */
	governor: boolean;
}

/** The value of a switch that must be one of a few words. */
export function readChoice<T extends string>(
	params: URLSearchParams,
	name: string,
	choices: readonly T[],
): T {
	const value = params.get(name);
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

/** The name a page publishes its result under: `hold`, `demo`, `soak` or `bench`. */
export function pageReport(params: URLSearchParams): 'hold' | 'demo' | 'soak' | 'bench' {
	if (params.has('hold')) return 'hold';
	if (params.has('demo')) return 'demo';
	return params.has('soak') ? 'soak' : 'bench';
}

/** A whole number that the engine checks itself. */
const whole = (v: number) => Number.isSafeInteger(v) && v > 0;

/**
 * Reads `?hold`, `?demo`, `?n=`, `?seconds=`, `?soak=`, `?shadows=`, `?governor=` and the shadow
 * quality settings.
 */
export function readRunOptions(params: URLSearchParams): RunOptions {
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
		count: readNumber(
			params,
			'n',
			(v) => Number.isSafeInteger(v) && v > 0,
			'a whole number above 0',
		),
		seconds: readNumber(
			params,
			'seconds',
			(v) => Number.isFinite(v) && v > 0,
			'a number of seconds above 0',
		),
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
		shadowCascades: readNumber(params, 'shadowCascades', whole, 'a cascade count from 1 to 4'),
		shadowMapSize: readNumber(params, 'shadowMapSize', whole, 'a size such as 2048'),
		shadowFilter: readNumber(params, 'shadowFilter', whole, 'a filter size of 3 or 5'),
		governor: !params.has('governor') || readChoice(params, 'governor', ['off']) !== 'off',
	};
}
