// The address switches that benchmark pages share. Each check fails with a message that says how to
// fix the address, and the page publishes that message as its error.

export interface RunOptions {
	/** `?hold`: render one frame at the hold time and publish its pixels, instead of a timed run. */
	hold: boolean;
	/** `?n=`: the instance count, or null to use the scene's default. */
	count: number | null;
	/** `?seconds=`: the warm-up and the measured time of a run, or null to use the protocol's. */
	seconds: number | null;
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

/** Reads `?hold`, `?n=` and `?seconds=`. */
export function readRunOptions(params: URLSearchParams): RunOptions {
	return {
		hold: params.has('hold'),
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
	};
}
