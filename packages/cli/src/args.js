// Reads the options of a command with Node's parser, and says in plain words what is wrong with
// them.
import { parseArgs } from 'node:util';

/** @import { ParseArgsOptionsConfig } from 'node:util' */

/** A mistake in the options that a command got. The command's help shows the right ones. */
export class UsageError extends Error {}

/**
 * The option that one of Node's parser errors names, such as `--size`.
 *
 * @param {string} message
 */
const optionIn = (message) => /'(-[^' ]+)/.exec(message)?.[1] ?? 'an option';

/**
 * The options that `args` gives, as `config` describes them. Throws a UsageError for an option the
 * command does not have, an option without its value, and an argument that is not an option.
 *
 * @template {ParseArgsOptionsConfig} T
 * @param {readonly string[]} args
 * @param {T} config
 */
export function readOptions(args, config) {
	try {
		return parseArgs({ args: [...args], options: config, strict: true, allowPositionals: false })
			.values;
	} catch (error) {
		const { code = '', message = '' } = /** @type {{ code?: string, message?: string }} */ (error);
		if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION')
			throw new UsageError(`${optionIn(message)} is not one of its options`);
		if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
			const option = optionIn(message);
			throw new UsageError(
				message.includes('ambiguous')
					? `${option} got a value that starts with a dash: write it as ${option}=<value>`
					: `${option} needs a value`,
			);
		}
		if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL')
			throw new UsageError(`it takes options only, not "${/'([^']*)'/.exec(message)?.[1] ?? ''}"`);
		throw error;
	}
}

/**
 * A number of seconds from an option's text: at least 0, or above 0 when `above` is set.
 *
 * @param {string} option The option's name, such as `--time`.
 * @param {string} text
 * @param {{ above?: boolean }} [rule]
 */
export function readSeconds(option, text, { above = false } = {}) {
	const seconds = text.trim() === '' ? Number.NaN : Number(text);
	if (Number.isFinite(seconds) && (above ? seconds > 0 : seconds >= 0)) return seconds;
	throw new UsageError(
		`${option} takes a number of seconds ${above ? 'above 0' : 'from 0'}, such as 1.5, not "${text}"`,
	);
}

/** The largest side of an image: WebGPU's default limit on a texture's size. */
export const MAX_SIDE = 8192;

/**
 * A size such as `1280x720`, in whole pixels from 1 to the largest side, or undefined for any
 * other text.
 *
 * @param {string} text
 * @returns {readonly [number, number] | undefined}
 */
export function parseSize(text) {
	const [width, height, extra] = text.split('x').map(Number);
	const side = (/** @type {number | undefined} */ n) =>
		n !== undefined && Number.isSafeInteger(n) && n >= 1 && n <= MAX_SIDE;
	if (extra === undefined && side(width) && side(height))
		return [/** @type {number} */ (width), /** @type {number} */ (height)];
	return undefined;
}

/**
 * What a setting of a size takes, for the message about a wrong value.
 *
 * @param {string} setting The setting, such as `--size`.
 * @param {string} text The wrong value.
 */
export const sizeRule = (setting, text) =>
	`${setting} takes a width and a height in pixels from 1 to ${MAX_SIDE}, such as 1280x720, not "${text}"`;
