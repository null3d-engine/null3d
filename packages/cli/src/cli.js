// The null3d command: reads the name of the command to run, runs it, and turns a mistake in its
// options into a message that points at the command's help.
import { readFileSync } from 'node:fs';
import { UsageError } from './args.js';

/** @typedef {{ run(args: readonly string[]): Promise<number> }} Command */

/**
 * The commands, each with its summary and its module, which loads only when the command runs.
 *
 * @type {Record<string, { summary: string, load: () => Promise<Command> }>}
 */
const COMMANDS = {
	shot: {
		summary: "Draws one frame of the project's page headless, and saves it as a PNG file",
		load: () => import('./shot.js'),
	},
};

/** The version of this package. */
export const VERSION = /** @type {string} */ (
	JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
);

const HELP = `null3D ${VERSION}: the command-line tool of the null3D engine

Usage: bunx @null3d/cli <command> [options]

Commands:
${Object.entries(COMMANDS)
	.map(([name, { summary }]) => `  ${name.padEnd(8)}${summary}`)
	.join('\n')}

Run bunx @null3d/cli <command> --help for a command's options.
Docs: https://github.com/null3d-engine/null3d/blob/main/docs/cli/null3d.md`;

/**
 * Runs the command that `args` names with the rest of `args`, and returns the exit code.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function main(args) {
	const [name, ...rest] = args;
	if (name === '--version' || name === '-v') {
		console.log(VERSION);
		return 0;
	}
	if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
		console.log(HELP);
		return 0;
	}
	const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
	if (!command) {
		console.error(
			`null3d has no "${name}" command. Its commands: ${Object.keys(COMMANDS).join(', ')}. Run bunx @null3d/cli --help for more.`,
		);
		return 1;
	}
	try {
		return await (await command.load()).run(rest);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(
			`null3d ${name}: ${error.message}. Run bunx @null3d/cli ${name} --help for its options.`,
		);
		return 1;
	}
}
