// null3d upgrade: moves every null3D package that the project's manifest names to one version, the
// version of the engine that the project runs. An add-on and the engine ship in step and pin each
// other's version, so a package left behind stops the page with E1432. The command writes the
// manifest alone: it edits no code and installs nothing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readOptions, UsageError } from './args.js';
import { VERSION } from './version.js';

const OPTIONS = /** @type {const} */ ({
	to: { type: 'string' },
	'dry-run': { type: 'boolean', default: false },
	help: { type: 'boolean', short: 'h', default: false },
});

/** The manifest in the project's folder. */
export const MANIFEST = 'package.json';
/** The package whose version the other null3D packages take. */
const ENGINE = '@null3d/engine';
/** The scope of the packages that the command moves together. */
const SCOPE = '@null3d/';
/**
 * The manifest sections that name a dependency, in the order that the command reads them. An
 * override pins a package's version for the whole tree, so it moves with the others.
 */
export const SECTIONS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
	'overrides',
];
/** A version, as the command writes it into the manifest. */
const VERSION_TEXT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const HELP = `Usage: bunx @null3d/cli upgrade [options]

Moves every null3D package that the project's package.json names to one version, the version of the
engine that the project runs. An add-on and the engine ship in step and pin the version of the
other, so a page that mixes two versions stops with E1432. The command changes the manifest only: it
edits no code and installs nothing.

Options:
  --to <version>   The version to move the packages to (the installed engine's version, or this
                   tool's own version when the project installs no engine)
  --dry-run        Prints the changes and writes nothing

Run bun install after it, to install the packages.`;

/**
 * The version that `--to` gives.
 *
 * @param {string} text
 */
export function readVersion(text) {
	if (VERSION_TEXT.test(text.trim())) return text.trim();
	throw new UsageError(`--to takes a version such as 0.2.0, not "${text}"`);
}

/**
 * @typedef {object} UpgradeOptions
 * @property {string} [to] The version to move every package to.
 * @property {boolean} dryRun True to print the changes and write nothing.
 * @property {boolean} [help] True to print the help instead.
 */

/**
 * The options that `args` gives the upgrade command.
 *
 * @param {readonly string[]} args
 * @returns {UpgradeOptions}
 */
export function parseUpgradeArgs(args) {
	const values = readOptions(args, OPTIONS);
	return {
		...(values.to !== undefined && { to: readVersion(values.to) }),
		dryRun: values['dry-run'],
		help: values.help,
	};
}

/**
 * Whether a manifest names a version of a package, rather than a file, a link or another source.
 * A local path, a workspace and a git address stay as the project wrote them.
 *
 * @param {string} specifier
 */
const namesVersion = (specifier) => !/^[a-z][a-z0-9+.-]*:/i.test(specifier);

/**
 * @typedef {object} Change One package that the command moves.
 * @property {string} section The manifest section that names it.
 * @property {string} name The package's name.
 * @property {string} from The specifier that the manifest holds now.
 * @property {string} to The version that the command writes.
 */

/**
 * @typedef {object} Entry One null3D package that a manifest names.
 * @property {string} section The manifest section that names it.
 * @property {string} name The package's name.
 * @property {string} specifier What the manifest holds for it.
 */

/**
 * Every null3D package that `manifest` names, in the sections that the command reads.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {Entry[]}
 */
function packageEntries(manifest) {
	/** @type {Entry[]} */
	const entries = [];
	for (const section of SECTIONS) {
		const named = manifest[section];
		if (typeof named !== 'object' || named === null || Array.isArray(named)) continue;
		for (const [name, specifier] of Object.entries(named)) {
			if (!name.startsWith(SCOPE) || typeof specifier !== 'string') continue;
			entries.push({ section, name, specifier });
		}
	}
	return entries;
}

/**
 * The changes that bring every null3D package in `manifest` to `to`. Packages that name a file, a
 * workspace or a git address stay as they are, and so does a package that already names `to`.
 *
 * @param {Record<string, unknown>} manifest
 * @param {string} to
 * @returns {Change[]}
 */
export function upgradeChanges(manifest, to) {
	return packageEntries(manifest)
		.filter(({ specifier }) => namesVersion(specifier) && specifier !== to)
		.map(({ section, name, specifier }) => ({ section, name, from: specifier, to }));
}

/**
 * Every null3D package that the manifest names, whatever its specifier.
 *
 * @param {Record<string, unknown>} manifest
 */
export function null3dPackages(manifest) {
	return packageEntries(manifest).map(({ name }) => name);
}

/**
 * The version that the packages take: `--to` when it is given, else the version of the engine that
 * the project installed, else the version of this tool, which releases with the engine.
 *
 * @param {string} root The project's folder.
 * @param {string | undefined} to
 */
export function targetVersion(root, to) {
	if (to !== undefined) return to;
	const installed = join(root, 'node_modules', ENGINE, MANIFEST);
	try {
		const version = JSON.parse(readFileSync(installed, 'utf8')).version;
		if (typeof version === 'string' && VERSION_TEXT.test(version)) return version;
	} catch {
		// No installed engine: the tool's own version belongs to the same release.
	}
	return VERSION;
}

/**
 * The manifest's text with `manifest` written in it, in the indentation that the text uses.
 *
 * @param {string} text The manifest as the file holds it.
 * @param {Record<string, unknown>} manifest
 */
export function rewrittenManifest(text, manifest) {
	const indent = /^[ \t]+/m.exec(text)?.[0] ?? '  ';
	return `${JSON.stringify(manifest, null, indent)}${text.endsWith('\n') ? '\n' : ''}`;
}

/**
 * @typedef {object} UpgradeResult What the command prints, and its exit code.
 * @property {number} code The exit code: 0 when the command did its work, 1 when it could not.
 * @property {string[]} lines The lines to print.
 */

/**
 * Moves the packages in the project at `root` to one version, and returns its lines and exit code.
 * With `dryRun`, it reads and plans and writes nothing.
 *
 * @param {string} root The project's folder.
 * @param {UpgradeOptions} options
 * @returns {UpgradeResult}
 */
export function upgradeProject(root, options) {
	const path = join(root, MANIFEST);
	if (!existsSync(path))
		return {
			code: 1,
			lines: [`${root} has no ${MANIFEST}. Run the command in the project's folder.`],
		};
	let text;
	/** @type {Record<string, unknown>} */
	let manifest;
	try {
		text = readFileSync(path, 'utf8');
		manifest = JSON.parse(text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { code: 1, lines: [`${MANIFEST} is not valid JSON: ${message}`] };
	}
	if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest))
		return { code: 1, lines: [`${MANIFEST} does not hold an object.`] };
	if (null3dPackages(manifest).length === 0)
		return { code: 0, lines: [`${MANIFEST} names no null3D package.`] };
	const to = targetVersion(root, options.to);
	const changes = upgradeChanges(manifest, to);
	if (changes.length === 0) {
		const takesVersion = packageEntries(manifest).some(({ specifier }) => namesVersion(specifier));
		return {
			code: 0,
			lines: [
				takesVersion
					? `Every null3D package is at ${to} already.`
					: 'Every null3D package names a file, a link or a workspace, so there is no version to change.',
			],
		};
	}
	const lines = changes.map(
		({ section, name, from, to: version }) => `${name}: ${from} -> ${version} (${section})`,
	);
	const count = `${changes.length} package${changes.length === 1 ? '' : 's'}`;
	if (options.dryRun) {
		lines.push(`Would move ${count} to ${to}. Run it without --dry-run to write ${MANIFEST}.`);
		return { code: 0, lines };
	}
	for (const change of changes) {
		const named = /** @type {Record<string, string>} */ (manifest[change.section]);
		named[change.name] = change.to;
	}
	writeFileSync(path, rewrittenManifest(text, manifest));
	lines.push(
		`Moved ${count} to ${to}. Run bun install to install ${changes.length === 1 ? 'it' : 'them'}.`,
	);
	return { code: 0, lines };
}

/**
 * Runs the upgrade command with its arguments, prints what it changed, and returns the exit code.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const options = parseUpgradeArgs(args);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	const result = upgradeProject(process.cwd(), options);
	const write = result.code === 0 ? console.log : console.error;
	for (const line of result.lines) write(line);
	return result.code;
}
