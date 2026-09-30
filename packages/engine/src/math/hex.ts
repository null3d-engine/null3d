// Reads hex colors for the public color helpers and for the engine's color inputs, which the engine
// does not export, and makes the error for a color that neither can read. Reading allocates
// nothing, so per-frame code can convert colors.

import { EngineError } from '../errors/engine-error';

/** The error E1204 for a color that `call` cannot read. */
export function invalidColor(color: unknown, call: string): EngineError {
	return new EngineError('E1204', `${call}() got the color ${JSON.stringify(color)}.`);
}

/** The value of one hex digit's character code, or -1 for a character that is not a hex digit. */
function hexDigit(code: number): number {
	if (code >= 48 && code <= 57) return code - 48;
	// Setting bit 5 turns 'A' to 'F' into 'a' to 'f'.
	const lower = code | 32;
	return lower >= 97 && lower <= 102 ? lower - 87 : -1;
}

/**
 * The value of a hex color from 0 to 0xffffff: a string such as '#4a8cff' or '#48f', or a whole
 * number such as 0x4a8cff. It is -1 for anything else.
 */
export function hexValue(hex: string | number): number {
	if (typeof hex === 'number')
		return Number.isInteger(hex) && hex >= 0 && hex <= 0xffffff ? hex : -1;
	if (typeof hex !== 'string' || hex.charCodeAt(0) !== 35) return -1;
	const digits = hex.length - 1;
	if (digits !== 3 && digits !== 6) return -1;
	let value = 0;
	for (let i = 1; i <= digits; i++) {
		const digit = hexDigit(hex.charCodeAt(i));
		if (digit < 0) return -1;
		// A short color doubles each digit: '#48f' is '#4488ff'.
		value = digits === 3 ? value * 256 + digit * 17 : value * 16 + digit;
	}
	return value;
}
