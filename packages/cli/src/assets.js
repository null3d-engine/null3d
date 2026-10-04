// null3d assets: the asset pipeline's commands. Each loads only when it runs.
import { UsageError } from './args.js';

/**
 * The asset commands, each with its summary and its module.
 *
 * @type {Record<string, { summary: string, load: () => Promise<{ run(args: readonly string[]): Promise<number> }> }>}
 */
const COMMANDS = {
	optimize: {
		summary:
			'Makes glTF models load and draw faster: quantized, compressed meshes and KTX2 textures',
		load: () => import('./assets/optimize.js'),
	},
};

export const HELP = `Usage: bunx @null3d/cli assets <command> [options]

Commands:
${Object.entries(COMMANDS)
	.map(([name, { summary }]) => `  ${name.padEnd(10)}${summary}`)
	.join('\n')}

Run bunx @null3d/cli assets <command> --help for a command's options.`;

/**
 * Runs the asset command that `args` names.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const [name, ...rest] = args;
	if (name === undefined || name === '--help' || name === '-h') {
		console.log(HELP);
		return 0;
	}
	const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
	if (!command)
		throw new UsageError(
			`it has no "${name}" command. Its commands: ${Object.keys(COMMANDS).join(', ')}`,
		);
	try {
		return await (await command.load()).run(rest);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(
			`null3d assets ${name}: ${error.message}. Run bunx @null3d/cli assets ${name} --help for its options.`,
		);
		return 1;
	}
}
