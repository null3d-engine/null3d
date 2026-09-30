// The checks of a project's code that come before its image tests: the TypeScript type check with
// the project's own TypeScript, and the project's own lint script. Each runs as a child process in
// the project's folder, so both can run while the browser draws.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { counted } from './text.js';

/**
 * The result of one check, as the test command prints it.
 *
 * @typedef {object} Outcome
 * @property {'PASS' | 'FAIL' | 'SKIP' | 'SAVED'} status SAVED marks an image that became its
 *   reference.
 * @property {string} text What was checked, and the reason for a failure or a skip.
 * @property {string[]} [details] Lines under the result, such as the errors that a check printed.
 */

/** The lines of a check's output that a failure shows. */
const SHOWN_OUTPUT_LINES = 20;

/**
 * A config of project references, which checks nothing by itself: `tsc --build` checks each
 * project that it names.
 */
const REFERENCES = /"references"\s*:\s*\[\s*\{/;

/**
 * Runs a command and returns its exit code and what it printed, without terminal colors. A command
 * that cannot start gives no code, and the reason as its output.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd: string, shell?: boolean, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function runProcess(command, args, { cwd, shell = false, env = process.env }) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd, shell, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		const collect = (/** @type {string} */ chunk) => {
			output += chunk;
		};
		child.stdout.setEncoding('utf8').on('data', collect);
		child.stderr.setEncoding('utf8').on('data', collect);
		child.on('error', (error) => resolve({ code: null, output: error.message }));
		child.on('close', (code) => resolve({ code, output: stripVTControlCharacters(output) }));
	});
}

/**
 * The first lines of a check's output that have text, and how many more it printed.
 *
 * @param {string} output
 */
function shownOutput(output) {
	const lines = output.split('\n').filter((line) => line.trim() !== '');
	const shown = lines.slice(0, SHOWN_OUTPUT_LINES);
	if (lines.length > shown.length)
		shown.push(`... ${counted(lines.length - shown.length, 'more line')}`);
	return shown;
}

/**
 * Type checks the project in `root` with its own TypeScript, when it has a `tsconfig.json`.
 *
 * @param {string} root
 * @returns {Promise<Outcome>}
 */
export async function typeCheck(root) {
	const config = join(root, 'tsconfig.json');
	if (!existsSync(config))
		return { status: 'SKIP', text: 'type check: the project has no tsconfig.json' };
	let tsc;
	try {
		tsc = join(dirname(createRequire(config).resolve('typescript/package.json')), 'bin', 'tsc');
	} catch {
		return {
			status: 'SKIP',
			text: 'type check: the project has a tsconfig.json but does not install TypeScript. Add it with bun add -d typescript',
		};
	}
	const args = REFERENCES.test(readFileSync(config, 'utf8'))
		? ['--build', '--noEmit']
		: ['--noEmit'];
	const check = `type check (tsc ${args.join(' ')})`;
	// One line per error, as in a terminal that is not a TTY, whatever the environment asks for.
	const { code, output } = await runProcess(process.execPath, [tsc, ...args, '--pretty', 'false'], {
		cwd: root,
	});
	if (code === 0) return { status: 'PASS', text: check };
	const errors = output.match(/error TS\d+/g)?.length ?? 0;
	return {
		status: 'FAIL',
		text: `${check}: ${errors > 0 ? counted(errors, 'error') : `tsc exited with ${code}`}`,
		details: shownOutput(output),
	};
}

/**
 * The folders of installed commands that a package manager puts first on the path when it runs a
 * script: `node_modules/.bin` in the project's folder and in each folder above it.
 *
 * @param {string} root
 */
function scriptPath(root) {
	const folders = [];
	for (let folder = root; ; folder = dirname(folder)) {
		const bin = join(folder, 'node_modules', '.bin');
		if (existsSync(bin)) folders.push(bin);
		if (dirname(folder) === folder) break;
	}
	return [...folders, process.env.PATH ?? ''].join(delimiter);
}

/**
 * The lint script of the project in `root`, from its `package.json`, or undefined.
 *
 * @param {string} root
 * @returns {string | undefined}
 */
function lintScript(root) {
	try {
		const script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts?.lint;
		return typeof script === 'string' ? script : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Runs the lint script of the project in `root`, as its package manager would, when it has one.
 *
 * @param {string} root
 * @returns {Promise<Outcome>}
 */
export async function lint(root) {
	const script = lintScript(root);
	if (script === undefined)
		return { status: 'SKIP', text: "lint: the project's package.json has no lint script" };
	const check = `lint (${script})`;
	const env = { ...process.env, PATH: scriptPath(root) };
	const { code, output } = await runProcess(script, [], { cwd: root, shell: true, env });
	if (code === 0) return { status: 'PASS', text: check };
	return {
		status: 'FAIL',
		text: `${check}: ${code === null ? 'it did not start' : `it exited with ${code}`}`,
		details: shownOutput(output),
	};
}
