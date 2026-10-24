// A timed script for the shot and test commands: one step per line, each with the sketch time at
// which it happens. The parser checks every line, and says what is wrong with it and on which line.
// The steps that drive the page go to the engine, and a shot step names an image that the command
// draws at its time.

import { readFileSync } from 'node:fs';
import { UsageError } from './args.js';

/** The most sketch time that the engine holds at, in seconds. */
export const MAX_SCRIPT_SECONDS = 600;

/** The most numbers that a property takes: a rotation as a quaternion. */
const MAX_VALUES = 4;

/**
 * @typedef {object} KeyStep
 * @property {number} at The sketch time of the step, in seconds.
 * @property {'key'} verb
 * @property {string} code The key's `KeyboardEvent.code` name.
 * @property {boolean} down True for a press, false for a release.
 *
 * @typedef {object} PointerStep
 * @property {number} at
 * @property {'pointer'} verb
 * @property {'move' | 'down' | 'up' | 'wheel'} action
 * @property {number} [x] The pointer's distance from the canvas's left edge, or a wheel's scroll.
 * @property {number} [y] The pointer's distance from the canvas's top edge, or a wheel's scroll.
 *
 * @typedef {object} SetStep
 * @property {number} at
 * @property {'set'} verb
 * @property {string} target The object's name, or `#camera`.
 * @property {string} path The property path.
 * @property {number[]} value The property's numbers.
 *
 * @typedef {object} ShotStep
 * @property {number} at
 * @property {'shot'} verb
 * @property {string} name The state's name, which names its image file.
 *
 * @typedef {object} DumpStep
 * @property {number} at
 * @property {'dump'} verb
 * @property {string} target The object's name, or `#camera`.
 * @property {string} [path] One property path, or none for every property of the object.
 *
 * @typedef {KeyStep | PointerStep | SetStep | ShotStep | DumpStep} ScriptStep
 */

/** The steps that a script takes, for a message about a line that takes none. */
export const SCRIPT_VERBS = ['key', 'pointer', 'set', 'shot', 'dump'];

/** The property names that a dump step's last dot separates from its target. */
const PROPERTY_NAMES = new Set([
	'position',
	'rotation',
	'scale',
	'visible',
	'fov',
	'near',
	'far',
	'height',
	'intensity',
	'color',
	'range',
	'decay',
	'angle',
	'penumbra',
]);

/** Names that become file names: lowercase words joined by dashes. */
const STEP_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A number of seconds, as a script writes it: digits and an optional fraction. */
const SECONDS = /^\d+(?:\.\d+)?$/;

/**
 * The line's time, in seconds, or a UsageError that names the line and what is wrong.
 *
 * @param {string} text
 * @param {number} line
 */
function readTime(text, line) {
	if (!SECONDS.test(text))
		throw new UsageError(
			`script line ${line}: "${text}" is not a time in seconds from 0, such as 1.5`,
		);
	const at = Number(text);
	if (at > MAX_SCRIPT_SECONDS)
		throw new UsageError(
			`script line ${line}: ${text} is past the ${MAX_SCRIPT_SECONDS} seconds that a hold steps through`,
		);
	return at;
}

/**
 * A number from a step's text, or a UsageError that names the line.
 *
 * @param {string} option
 * @param {string} text
 * @param {number} line
 */
function readNumber(option, text, line) {
	const value = text.trim() === '' ? Number.NaN : Number(text);
	if (Number.isFinite(value)) return value;
	throw new UsageError(`script line ${line}: ${option} takes a number, not "${text}"`);
}

/**
 * One or two coordinates from a pointer step, or a UsageError that names the line.
 *
 * @param {string} action
 * @param {readonly string[]} words
 * @param {number} line
 * @param {{ required: boolean }} rule
 */
function readPoint(action, words, line, { required }) {
	if (words.length === 0 && !required) return {};
	if (words.length !== 2)
		throw new UsageError(
			`script line ${line}: "pointer ${action}" takes ${required ? 'two numbers' : 'two numbers, or none to keep the pointer where it is'}, such as "pointer ${action} 640 360"`,
		);
	return {
		x: readNumber(`pointer ${action}'s first number`, /** @type {string} */ (words[0]), line),
		y: readNumber(`pointer ${action}'s second number`, /** @type {string} */ (words[1]), line),
	};
}

/**
 * The numbers of a property, as `set` writes them: numbers joined by commas or spaces, and `true` or
 * `false` for a flag. Throws a UsageError that names the line.
 *
 * @param {string} text
 * @param {number} line
 */
export function readValues(text, line) {
	const words = text
		.trim()
		.split(/[\s,]+/)
		.filter((word) => word !== '');
	if (words.length === 0 || words.length > MAX_VALUES)
		throw new UsageError(
			`script line ${line}: a set step takes 1 to ${MAX_VALUES} numbers after =, such as 1, 2, 0`,
		);
	return words.map((word) => {
		if (word === 'true') return 1;
		if (word === 'false') return 0;
		const value = readNumber('a set step', word, line);
		return value;
	});
}

/**
 * A target and the property path that follows it, split at the last dot: the object's name may
 * contain dots, as glTF node names do, and the path never does.
 *
 * @param {string} text
 * @param {number} line
 * @returns {{ target: string, path: string }}
 */
function readTargetPath(text, line) {
	const dot = text.lastIndexOf('.');
	const target = dot > 0 ? text.slice(0, dot) : '';
	const path = dot > 0 ? text.slice(dot + 1) : '';
	if (target === '' || path === '')
		throw new UsageError(
			`script line ${line}: name an object and a property, such as car.position, with a dot between them`,
		);
	return { target, path };
}

/**
 * The step that a line gives, or a UsageError that says what is wrong with it.
 *
 * @param {string} text
 * @param {number} line
 * @returns {ScriptStep}
 */
function readLine(text, line) {
	const [time, verb, ...words] = text.split(/\s+/);
	const at = readTime(/** @type {string} */ (time), line);
	if (verb === 'key') {
		const [code, action, extra] = words;
		if (code === undefined || (action !== 'down' && action !== 'up') || extra !== undefined)
			throw new UsageError(
				`script line ${line}: a key step reads "key <code> down" or "key <code> up", such as "key KeyW down"`,
			);
		return { at, verb: 'key', code, down: action === 'down' };
	}
	if (verb === 'pointer') {
		const [action, ...rest] = words;
		if (action === 'move' || action === 'wheel') {
			const point = readPoint(action, rest, line, { required: true });
			return { at, verb: 'pointer', action, ...point };
		}
		if (action === 'down' || action === 'up') {
			const point = readPoint(action, rest, line, { required: false });
			return { at, verb: 'pointer', action, ...point };
		}
		throw new UsageError(
			`script line ${line}: a pointer step takes move, down, up or wheel, such as "pointer move 640 360"`,
		);
	}
	if (verb === 'set') {
		const joined = words.join(' ');
		const equals = joined.indexOf('=');
		if (equals < 0)
			throw new UsageError(
				`script line ${line}: a set step takes <object>.<property>=<value>, such as "set car.position=0, 2, 0"`,
			);
		const { target, path } = readTargetPath(joined.slice(0, equals).trim(), line);
		return { at, verb: 'set', target, path, value: readValues(joined.slice(equals + 1), line) };
	}
	if (verb === 'shot') {
		const [name, extra] = words;
		if (name === undefined || extra !== undefined || !STEP_NAME.test(name))
			throw new UsageError(
				`script line ${line}: a shot step takes one name of lowercase words joined by dashes, such as "shot driving"`,
			);
		return { at, verb: 'shot', name };
	}
	if (verb === 'dump') {
		const [name, extra] = words;
		if (name === undefined || extra !== undefined)
			throw new UsageError(
				`script line ${line}: a dump step takes one object, or an object and a property, such as "dump car.position"`,
			);
		const dot = name.lastIndexOf('.');
		// A dot names a property only when what follows it is a property's name: an object's own
		// name may contain dots.
		if (dot > 0 && PROPERTY_NAMES.has(name.slice(dot + 1)))
			return { at, verb: 'dump', target: name.slice(0, dot), path: name.slice(dot + 1) };
		return { at, verb: 'dump', target: name };
	}
	throw new UsageError(
		`script line ${line}: "${verb ?? ''}" is not a step that a script takes. Its steps are ${SCRIPT_VERBS.slice(0, -1).join(', ')} and ${SCRIPT_VERBS.at(-1)}`,
	);
}

/**
 * The steps that the text of a script gives, in time order. Throws a UsageError that names the line
 * for a line that is not a step, a time that falls back, two shot steps with one name, and two
 * shots at one time.
 *
 * @param {string} text
 * @returns {ScriptStep[]}
 */
export function parseScript(text) {
	/** @type {ScriptStep[]} */
	const steps = [];
	const shotNames = new Set();
	const shotTimes = new Set();
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = (lines[index] ?? '').trim();
		if (line === '' || line.startsWith('#')) continue;
		const number = index + 1;
		const step = readLine(line, number);
		const previous = steps.at(-1);
		if (previous !== undefined && step.at < previous.at)
			throw new UsageError(
				`script line ${number}: ${step.at} s falls before the step at ${previous.at} s above it. A script's steps come in time order`,
			);
		if (step.verb === 'shot') {
			if (shotNames.has(step.name))
				throw new UsageError(`script line ${number}: two shot steps are named "${step.name}"`);
			if (shotTimes.has(step.at))
				throw new UsageError(
					`script line ${number}: another shot step is at ${step.at} s. Give each shot its own time`,
				);
			shotNames.add(step.name);
			shotTimes.add(step.at);
		}
		steps.push(step);
	}
	return steps;
}

/**
 * The script that a file holds.
 *
 * @param {string} file
 * @returns {ScriptStep[]}
 */
export function readScript(file) {
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		throw new UsageError(
			`cannot read the script ${file}: ${error instanceof Error ? error.message : error}`,
		);
	}
	return parseScript(text);
}

/**
 * The program that the engine performs: every step but the shots, whose times the command uses
 * itself. Its shape is the engine's `HoldScript`.
 *
 * @param {readonly ScriptStep[]} steps
 * @returns {import('./page.js').HoldScript}
 */
export function scriptProgram(steps) {
	const program = steps
		.filter((step) => step.verb !== 'shot')
		.map((step) =>
			step.verb === 'pointer'
				? {
						at: step.at,
						verb: step.verb,
						action: step.action,
						...(step.x !== undefined && { x: step.x }),
						...(step.y !== undefined && { y: step.y }),
					}
				: step,
		);
	return { steps: /** @type {import('./page.js').HoldScriptStep[]} */ (program) };
}

/**
 * The shot steps of a script, in time order.
 *
 * @param {readonly ScriptStep[]} steps
 * @returns {ShotStep[]}
 */
export const shotSteps = (steps) => steps.filter((step) => step.verb === 'shot');

/**
 * The sketch times at which a script draws a shot or reads a dump, in order, once each: the times
 * at which a command holds the page.
 *
 * @param {readonly ScriptStep[]} steps
 * @returns {number[]}
 */
export const scriptReadTimes = (steps) =>
	[
		...new Set(
			steps.filter((step) => step.verb === 'shot' || step.verb === 'dump').map((step) => step.at),
		),
	].sort((a, b) => a - b);

/**
 * The shot step at a time, or undefined when the script draws no image then.
 *
 * @param {readonly ScriptStep[]} steps
 * @param {number} at
 * @returns {ShotStep | undefined}
 */
export function shotAt(steps, at) {
	const found = steps.find((step) => step.verb === 'shot' && step.at === at);
	return found?.verb === 'shot' ? found : undefined;
}

/**
 * What several holds of one script read, once each: every dump in time order, and every step that
 * failed. A command holds the page once at each time that a step reads, so early steps appear in
 * each hold's result.
 *
 * @param {readonly (import('./page.js').HoldScriptResult | undefined)[]} reads
 * @returns {{ dumps: import('./page.js').HoldDump[], problems: import('./page.js').HoldScriptProblem[] }}
 */
export function scriptReads(reads) {
	/** @type {Map<string, import('./page.js').HoldDump>} */
	const dumps = new Map();
	/** @type {Map<string, import('./page.js').HoldScriptProblem>} */
	const problems = new Map();
	for (const read of reads) {
		for (const dump of read?.dumps ?? []) {
			const key = `${dump.at}\n${dump.target}\n${dump.path ?? ''}\n${JSON.stringify(dump.value)}`;
			if (!dumps.has(key)) dumps.set(key, dump);
		}
		for (const problem of read?.problems ?? []) {
			const key = `${problem.at}\n${problem.step}\n${problem.error}`;
			if (!problems.has(key)) problems.set(key, problem);
		}
	}
	return { dumps: [...dumps.values()], problems: [...problems.values()] };
}
