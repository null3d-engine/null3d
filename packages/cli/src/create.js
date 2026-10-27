// null3d create: makes a new project from one of the templates that ship with this command. It
// copies the template's files, writes the version of the command and the project's name into
// them, and installs nothing. The template holds an AGENTS.md for AI agents and one hook that
// Claude Code and Codex both run.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArguments, UsageError } from './args.js';
import { shownPath } from './text.js';
import { VERSION } from './version.js';

/** The templates that ship with the command. */
export const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
/** The text that each template file holds in place of the command's version. */
export const VERSION_TOKEN = '{{null3dVersion}}';
/** The text that each template file holds in place of the project's name. */
export const NAME_TOKEN = '{{name}}';
/** The template files whose names the command changes, so git keeps the source file. */
const RENAMED = new Map([['gitignore', '.gitignore']]);
/** The template that the command uses when `--template` names none. */
const DEFAULT_TEMPLATE = 'empty';

const OPTIONS = /** @type {const} */ ({
	template: { type: 'string', default: DEFAULT_TEMPLATE },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli create <folder> [options]

Makes a new null3D project in the folder from a template. The folder must not exist, or must be
empty. The command copies the template and writes its own version into its files. It installs
nothing.

Options:
  --template <name>   The template to use (${DEFAULT_TEMPLATE})

The project holds an AGENTS.md for AI agents and one agent hook that Claude Code and Codex both run.
Run bun install in the new folder, then bunx vite.`;

/**
 * @typedef {object} CreateOptions
 * @property {string} dir The folder to make the project in.
 * @property {string} template The template's name.
 * @property {boolean} help True to print the help instead.
 */

/**
 * The options that `args` gives the create command.
 *
 * @param {readonly string[]} args
 * @returns {CreateOptions}
 */
export function parseCreateArgs(args) {
	const { values, positionals } = readArguments(args, OPTIONS, true);
	if (values.help) return { dir: positionals[0] ?? '', template: values.template, help: true };
	const dir = positionals[0];
	if (dir === undefined || positionals.length > 1) {
		throw new UsageError(
			positionals.length > 1
				? `it takes one folder, not ${positionals.length}`
				: 'it needs the folder to make the project in',
		);
	}
	return { dir, template: values.template, help: values.help };
}

/**
 * The names of the templates that ship with the command, in order.
 *
 * @param {string} [root] The templates' folder.
 * @returns {string[]}
 */
export function templateNames(root = TEMPLATES) {
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

/**
 * A package name from the folder's name: lowercase, with a dash in place of each run of other
 * characters.
 *
 * @param {string} dir
 */
export function packageNameFor(dir) {
	return (
		basename(resolve(dir))
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^[._-]+|[._-]+$/g, '') || 'null3d-project'
	);
}

/**
 * Writes the files of `from` into `to`, with the version, the name and the renamed files.
 *
 * @param {string} from
 * @param {string} to
 * @param {{ version: string, name: string }} values
 */
function copyTemplate(from, to, values) {
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		const source = join(from, entry.name);
		const name = RENAMED.get(entry.name) ?? entry.name;
		const target = join(to, name);
		if (entry.isDirectory()) {
			mkdirSync(target, { recursive: true });
			copyTemplate(source, target, values);
		} else {
			const bytes = readFileSync(source);
			const text = bytes.toString('utf8');
			writeFileSync(
				target,
				text.includes('\u0000')
					? bytes
					: text.replaceAll(VERSION_TOKEN, values.version).replaceAll(NAME_TOKEN, values.name),
			);
		}
	}
}

/**
 * Makes the project in `dir` from `template`, and returns its path.
 *
 * @param {{ dir: string, template?: string, version?: string, templates?: string }} options
 * @returns {string}
 */
export function createProject({
	dir,
	template = DEFAULT_TEMPLATE,
	version = VERSION,
	templates = TEMPLATES,
}) {
	const names = templateNames(templates);
	if (!names.includes(template)) {
		throw new UsageError(`it has no "${template}" template; its templates: ${names.join(', ')}`);
	}
	const target = resolve(dir);
	if (existsSync(target)) {
		if (!statSync(target).isDirectory())
			throw new UsageError(`"${dir}" is a file, and create needs a folder`);
		const own = ['.claude/settings.json', '.codex/hooks.json'].find((file) =>
			existsSync(join(target, file)),
		);
		if (own !== undefined)
			throw new UsageError(
				`"${dir}" already has ${own}, which can hold your own hooks. create left it as it is: use an empty folder, or move that file first`,
			);
		if (readdirSync(target).length > 0)
			throw new UsageError(`"${dir}" is not empty, and create needs an empty folder`);
	}
	mkdirSync(target, { recursive: true });
	copyTemplate(join(templates, template), target, {
		version,
		name: packageNameFor(target),
	});
	return target;
}

/**
 * Runs the create command with its arguments, and returns the exit code.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const options = parseCreateArgs(args);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	const target = createProject(options);
	console.log(
		[
			`Made ${shownPath(target)} from the ${options.template} template, with null3D ${VERSION}.`,
			'',
			`  cd ${shownPath(target)}`,
			'  bun install',
			'  bunx vite',
		].join('\n'),
	);
	return 0;
}
