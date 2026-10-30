// null3d check-addon: runs the engine's gates on one add-on package, so its author and a listing
// see the same checks the engine's own add-ons answer. The gates run on the package in a folder:
// the entry points that its shipped code imports, the plugin interface that it declares, a build
// that compiles its shaders for WebGPU and WebGL2, and the sizes of the files it loads after the
// start. With a page in the project's config, a browser opens that page for the remaining gates.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { readArguments, UsageError } from './args.js';
import { measurePage } from './bench.js';
import { WEBGPU_DEVELOPER_FEATURES } from './browser.js';
import {
	attachWorkers,
	DevTools,
	freePort,
	HeapSampler,
	pagesAt,
	sampledFrames,
	sleep,
} from './devtools.js';
import { placeName, profilePlaces, steadyPlaces, totalSize } from './heap-profile.js';
import { ENGINE_GLOBAL, holdPath, holdResult, switchedPath } from './page.js';
import { MEASURE_SECONDS, WARMUP_SECONDS } from './protocol.js';
import { failure, pollPage, startRunner, visitPage } from './runner.js';
import { BuildNames } from './source-names.js';
import { outcomeText, summaryLine } from './test.js';
import { readTestConfig } from './test-config.js';
import { counted } from './text.js';

/** @import { Outcome } from './project-checks.js' */
/** @import { CallFrame, ProfileNode, Sample } from './heap-profile.js' */
/** @import { HoldFailure } from './page.js' */
/** @import { Page } from 'playwright-core' */
/** @import { Runner } from './runner.js' */
/** @import { TargetInfo } from './devtools.js' */

/** The file that names an add-on's package, in its folder. */
const MANIFEST = 'package.json';

/** The engine's entry points that an add-on may import. */
const PUBLIC_ENTRIES = new Set(['@null3d/engine', '@null3d/engine/stats']);

/** The engine's entry-point prefix. */
const ENGINE_ENTRY = '@null3d/engine';

/**
 * The packages that stay out of an add-on's build: every null3D package. A foundation add-on may
 * build on another foundation, and a page loads that package as a dependency of its own. So the
 * build measures the add-on's own files alone, as it measures them for the engine.
 */
export const ADDON_EXTERNALS = [/^@null3d\//];

/** The package scope of the engine's own add-ons, which pin the engine version. */
const ENGINE_SCOPE = '@null3d/';

/** Source files that the import gate reads. */
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

/** Test and declaration files, which the gate does not read. */
const NOT_SHIPPED = /(?:\.test\.[cm]?[jt]sx?|\.d\.[cm]?[jt]s)$/;

/** The import specifiers in a source file, in every form that JavaScript and TypeScript write. */
const SPECIFIERS = [
	/\bfrom\s*['"]([^'"]+)['"]/g,
	/\bimport\s*['"]([^'"]+)['"]/g,
	/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** The call that an outside add-on makes to declare its plugin interface range. */
const INTERFACE_CALL =
	/checkPluginInterface\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*min:\s*(\d+|PLUGIN_INTERFACE_VERSION)\s*,\s*max:\s*(\d+|PLUGIN_INTERFACE_VERSION)\s*,?\s*\}\s*\)/;

/** The call that an engine add-on makes to pin the engine version. */
const VERSION_CALL = /checkAddonVersion\(\s*['"]([^'"]+)['"]\s*,\s*VERSION\s*\)/;

/**
 * The budget of each column for a file that an add-on loads after the start (D-14). It follows the
 * engine's own figure for the same kind of file, which has room for the glTF worker's
 * texture-transform pointers; an add-on may not take more room than the engine allows it.
 */
export const ADDON_FILE_BUDGET = { raw: 64 * 1024, gzip: 24 * 1024, brotli: 18 * 1024 };

/**
 * The budget of each column for a built file that holds compiled shader builds (D-14, D-215). The
 * plugin puts custom materials' builds in files of their own, which a page loads on the material's
 * first use. They are shader data, so they take the first-use shader budget rather than the code
 * budget above. The engine's size report keeps the same figures for its own first-use shader files,
 * and a test keeps these equal to that report's.
 */
export const ADDON_SHADER_BUDGET = { raw: 1792 * 1024, gzip: 320 * 1024, brotli: 56 * 1024 };

/**
 * A built file that holds compiled shader builds: the plugin names each set after its kind, its
 * GPU path and permutation bits, and the build adds a hash to the name. A material's set names the
 * bits that pick it; an effect's and a tone curve's take one set for each GPU path alone.
 */
const SHADER_BUILDS_FILE =
	/^(?:material|effect|curve)-(?:wgsl|glsl)-\d+-[0-9a-f]+(?:-[A-Za-z0-9_-]+)?\.js$/;

/** The columns that a size report shows. */
const COLUMNS = /** @type {const} */ (['raw', 'gzip', 'brotli']);

/** How many lines of a build error the result shows. */
const SHOWN_LINES = 12;

const OPTIONS = /** @type {const} */ ({
	page: { type: 'string' },
	'skip-browser': { type: 'boolean', default: false },
	'skip-cost': { type: 'boolean', default: false },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli check-addon [folder] [options]

Runs the engine's gates on one add-on package, in \`folder\` (the current folder without one):
  public API   the shipped code reaches the engine only through @null3d/engine and
               @null3d/engine/stats; another package that it names loads on its own
  interface    the entry declares the plugin interface that it works with, or, for a null3D
               package, pins the engine version
  shaders      a build compiles the add-on's WGSL for WebGPU and WebGL2
  sizes        each file that the add-on loads after the start is checked against its
               budget; a file over budget warns, and does not fail the check
  page         with a page, it starts from another origin under the strict policy
  cost         with a page, its cost per frame is measured on each quality preset
  allocation   with a page, the bytes that the add-on's own code allocates per frame are
               measured on each quality preset

The page comes from \`page\` in the first test of null3d.json, or from --page. Without one, the
page gates are skipped.

Options:
  --page <path>       The page to open, from the project's root, such as /demo.html, instead of
                      the config's
  --skip-browser      Run no gate that opens a browser
  --skip-cost         Leave out the cost gate alone, for a machine whose load would show in its
                      figures; the page and allocation gates still run
  --help              Print this help`;

/**
 * The options that `args` gives the command, and the add-on's folder.
 *
 * @param {readonly string[]} args
 */
export function parseCheckAddonArgs(args) {
	const { values, positionals } = readArguments(args, OPTIONS, true);
	if (positionals.length > 1)
		throw new UsageError(`it checks one folder, not "${positionals[1] ?? ''}"`);
	if (values.page !== undefined && !values.page.startsWith('/'))
		throw new UsageError(
			`--page takes a path from the project's root that starts with /, such as /demo.html, not "${values.page}"`,
		);
	return {
		folder: positionals[0] ?? process.cwd(),
		page: values.page,
		skipBrowser: values['skip-browser'],
		skipCost: values['skip-cost'],
		help: values.help,
	};
}

/**
 * The package that an add-on's manifest names, and the entry file that its code starts from.
 *
 * @param {Record<string, unknown>} manifest
 * @param {string} folder
 * @returns {string | undefined}
 */
function entryOf(manifest, folder) {
	const exportsField = /** @type {Record<string, unknown> | undefined} */ (manifest.exports);
	const root = exportsField?.['.'];
	const candidates = [
		typeof root === 'object' && root !== null
			? /** @type {Record<string, unknown>} */ (root)['null3d-source']
			: undefined,
		typeof root === 'object' && root !== null
			? /** @type {Record<string, unknown>} */ (root).default
			: undefined,
		typeof root === 'string' ? root : undefined,
		manifest.module,
		manifest.main,
		'src/index.ts',
		'src/index.js',
	];
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue;
		const path = resolve(folder, candidate);
		if (existsSync(path) && SOURCE.test(path)) return path;
	}
	return undefined;
}

/**
 * Reads the add-on's manifest, or says what is wrong with it.
 *
 * @param {string} folder
 * @returns {{ name?: string, entry?: string, problems: string[] }}
 */
export function readAddon(folder) {
	const path = join(folder, MANIFEST);
	if (!existsSync(path)) return { problems: [`${MANIFEST} does not exist in this folder`] };
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		return {
			problems: [`${MANIFEST} is not JSON: ${error instanceof Error ? error.message : error}`],
		};
	}
	if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest))
		return { problems: [`${MANIFEST} is not an object`] };
	const fields = /** @type {Record<string, unknown>} */ (manifest);
	if (typeof fields.name !== 'string' || fields.name === '')
		return { problems: [`${MANIFEST} names no package in its "name" field`] };
	const entry = entryOf(fields, folder);
	if (entry === undefined)
		return {
			name: fields.name,
			problems: ['no entry file: set "exports", "module" or "main", or add src/index.ts'],
		};
	return { name: fields.name, entry, problems: [] };
}

/**
 * The shipped source files under `folder`, as absolute paths.
 *
 * @param {string} folder
 * @returns {string[]}
 */
export function shippedFiles(folder) {
	const from = existsSync(join(folder, 'src')) ? join(folder, 'src') : folder;
	let entries;
	try {
		entries = readdirSync(from, { recursive: true, encoding: 'utf8' });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => SOURCE.test(entry) && !NOT_SHIPPED.test(entry))
		.filter((entry) => !entry.split(sep).includes('node_modules'))
		.filter((entry) => !entry.split(sep).some((part) => part === 'test' || part === 'tests'))
		.map((entry) => join(from, entry));
}

/**
 * The folder of the engine that the add-on builds against, found beside the add-on's manifest.
 *
 * @param {string} folder
 * @returns {string | undefined}
 */
function engineFolder(folder) {
	try {
		const require = createRequire(join(folder, MANIFEST));
		return dirname(require.resolve(`${ENGINE_ENTRY}/${MANIFEST}`));
	} catch {
		return undefined;
	}
}

/**
 * The engine's version and plugin interface version, read from the version module beside its entry.
 * The module holds them as plain constants, so the check needs no engine code in its own process.
 *
 * @param {string} folder
 * @returns {{ version: string, pluginInterface: number } | undefined}
 */
export function engineVersions(folder) {
	const root = engineFolder(folder);
	/** @type {string[]} */
	const paths = [];
	if (root !== undefined) {
		paths.push(join(root, 'src/shared/version.ts'), join(root, 'lib/shared/version.js'));
	}
	// An add-on checked out inside the engine's repository reads its engine without an install.
	for (let dir = resolve(folder); ; dir = dirname(dir)) {
		const path = join(dir, 'packages/engine/src/shared/version.ts');
		if (existsSync(path)) {
			paths.push(path);
			break;
		}
		if (dirname(dir) === dir) break;
	}
	for (const path of paths) {
		if (!existsSync(path)) continue;
		const text = readFileSync(path, 'utf8');
		const version = /export const VERSION = '([^']+)'/.exec(text)?.[1];
		const pluginInterface = /export const PLUGIN_INTERFACE_VERSION = (\d+)/.exec(text)?.[1];
		if (version !== undefined && pluginInterface !== undefined)
			return { version, pluginInterface: Number(pluginInterface) };
	}
	return undefined;
}

/**
 * Why `file` importing `specifier` breaks the public-API rule, or nothing when the import keeps it.
 *
 * @param {string} file
 * @param {string} specifier
 * @param {string | undefined} engineRoot
 * @returns {string | undefined}
 */
function importProblem(file, specifier, engineRoot) {
	if (specifier === ENGINE_ENTRY || specifier.startsWith(`${ENGINE_ENTRY}/`))
		return PUBLIC_ENTRIES.has(specifier)
			? undefined
			: `imports ${specifier}, which is not a public entry point`;
	if (engineRoot !== undefined && specifier.startsWith('.')) {
		const target = resolve(dirname(file), specifier);
		if (`${target}${sep}`.startsWith(`${engineRoot}${sep}`))
			return `imports the engine's source (${specifier})`;
	}
	return undefined;
}

/**
 * Every import in the add-on's shipped code that breaks the public-API rule.
 *
 * @param {string} folder
 * @returns {{ problems: string[], files: number }}
 */
export function publicApiProblems(folder) {
	const files = shippedFiles(folder);
	const root = engineFolder(folder);
	const engineRoot = root === undefined ? undefined : join(root, 'src');
	const problems = [];
	for (const file of files) {
		const text = readFileSync(file, 'utf8');
		for (const pattern of SPECIFIERS) {
			pattern.lastIndex = 0;
			for (const match of text.matchAll(pattern)) {
				const specifier = match[1] ?? '';
				const problem = importProblem(file, specifier, engineRoot);
				if (problem !== undefined) problems.push(`${relative(folder, file)} ${problem}`);
			}
		}
	}
	return { problems: [...new Set(problems)], files: files.length };
}

/**
 * The text of the argument of the call named `callee` in `text`, or undefined when it is absent.
 * The scan keeps a depth count, so an inner call or object does not end it early.
 *
 * @param {string} text
 * @param {string} callee
 * @returns {string | undefined}
 */
function callArgument(text, callee) {
	const at = text.indexOf(`${callee}(`);
	if (at < 0) return undefined;
	let depth = 0;
	for (let i = at + callee.length; i < text.length; i++) {
		if (text[i] === '(') depth += 1;
		else if (text[i] === ')') {
			depth -= 1;
			if (depth === 0) return text.slice(at + callee.length + 1, i);
		}
	}
	return undefined;
}

/**
 * The plugin interface that an add-on's entry declares, read from either form: a standalone
 * `checkPluginInterface(name, { min, max })` call, or the `pluginInterface` field of its
 * `declareAddonNamespace({ ... })` registration.
 *
 * @param {string} text
 * @returns {{ form: 'call' | 'namespace', name?: string, min?: string, max?: string } | undefined}
 */
function declarationOf(text) {
	const call = INTERFACE_CALL.exec(text);
	if (call !== null) return { form: 'call', name: call[1], min: call[2], max: call[3] };
	const args = callArgument(text, 'declareAddonNamespace');
	if (args === undefined) return undefined;
	// The namespace's name is the add-on's own short name, not its package name.
	const name = /name:\s*['"]([^'"]+)['"]/.exec(args)?.[1];
	const field = /pluginInterface:\s*\{/.exec(args);
	if (field === null) return { form: 'namespace', name };
	// The field's own object, to its closing brace.
	let depth = 0;
	/** @type {number | undefined} */
	let end;
	for (let i = field.index + field[0].length - 1; i < args.length; i++) {
		if (args[i] === '{') depth += 1;
		else if (args[i] === '}') {
			depth -= 1;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end === undefined) return { form: 'namespace', name };
	const inner = args.slice(field.index + field[0].length, end);
	const read = (/** @type {string} */ key) =>
		new RegExp(`\\b${key}:\\s*(\\d+|PLUGIN_INTERFACE_VERSION)`).exec(inner)?.[1];
	return { form: 'namespace', name, min: read('min'), max: read('max') };
}

/**
 * Why the add-on's declaration does not fit this engine, or nothing when it does. An engine add-on
 * pins the engine version; an add-on from another developer declares a plugin interface range.
 *
 * @param {string} name
 * @param {string} entry
 * @param {{ version: string, pluginInterface: number }} engine
 * @returns {{ problem?: string, text: string }}
 */
export function interfaceResult(name, entry, engine) {
	const text = readFileSync(entry, 'utf8');
	if (name.startsWith(ENGINE_SCOPE)) {
		const called = VERSION_CALL.exec(text)?.[1];
		if (called === undefined)
			return {
				problem:
					'declares no engine version: call checkAddonVersion(name, VERSION) as the module loads',
				text: '',
			};
		if (called !== name)
			return { problem: `checks itself as "${called}", and its package is ${name}`, text: '' };
		return { text: `pins null3D ${engine.version}` };
	}
	const declaration = declarationOf(text);
	if (declaration === undefined || declaration.min === undefined || declaration.max === undefined)
		return {
			problem: `declares no plugin interface range: call checkPluginInterface('${name}', { min, max }), or add pluginInterface: { min, max } to declareAddonNamespace(), as the module loads`,
			text: '',
		};
	const called = declaration.name ?? name;
	if (declaration.form === 'call' && called !== name)
		return { problem: `checks itself as "${called}", and its package is ${name}`, text: '' };
	const read = (/** @type {string} */ value) =>
		value === 'PLUGIN_INTERFACE_VERSION' ? engine.pluginInterface : Number(value);
	const min = read(declaration.min ?? '');
	const max = read(declaration.max ?? '');
	if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min)
		return {
			problem: `declares plugin interface versions ${min} to ${max}, which is no range`,
			text: '',
		};
	if (engine.pluginInterface < min || engine.pluginInterface > max)
		return {
			problem: `was built for plugin interface ${min === max ? `${min}` : `${min} to ${max}`}, and this engine has ${engine.pluginInterface}`,
			text: '',
		};
	return {
		text: `declares plugin interface ${min === max ? `${min}` : `${min} to ${max}`}, and this engine has ${engine.pluginInterface}`,
	};
}

/**
 * The add-on's own Vite and null3D plugin, which the build compiles its shaders with.
 *
 * @param {string} folder
 * @returns {{ vite: string, plugin: string } | undefined}
 */
function buildTools(folder) {
	const require = createRequire(join(folder, MANIFEST));
	/** @type {string} */
	let vite;
	/** @type {string} */
	let root;
	try {
		vite = require.resolve('vite');
		// The package's manifest is a file that every published copy exports, where its entry is
		// built in a published copy and kept as source in a checkout.
		root = dirname(require.resolve('@null3d/vite-plugin/package.json'));
	} catch {
		return undefined;
	}
	for (const plugin of [join(root, 'lib/index.js'), join(root, 'src/index.ts')]) {
		if (existsSync(plugin)) return { vite, plugin };
	}
	return undefined;
}

/**
 * One buffer's size in each column.
 *
 * @typedef {object} ByteSize
 * @property {number} raw
 * @property {number} gzip
 * @property {number} brotli
 */

/**
 * One file that a build wrote. The three columns are what a page downloads. `code` and `shader`
 * split that file by what it holds: the add-on's own code, and the compiled WGSL that the plugin
 * inlines in it. The two parts add up to the whole in every column. A file of a build that holds
 * no compiled WGSL has no split, and its whole size answers the code budget.
 *
 * @typedef {object} BuiltFileSize
 * @property {string} name
 * @property {string} [text] The file's text, so a test can read what it imports.
 * @property {number} raw
 * @property {number} gzip
 * @property {number} brotli
 * @property {ByteSize} [code]
 * @property {ByteSize} [shader]
 */

/** A file that a module imports as WGSL, which the plugin compiles for both GPU paths. */
const WGSL_IMPORT = /\.wgsl$/;

/**
 * A Vite plugin that answers each WGSL import with an empty module. A build with it writes the
 * add-on's code alone: no shader compiles, and nothing of one reaches a file. The difference from
 * a build with the null3D plugin is the shader data that the plugin inlined.
 */
export function emptyShaders() {
	return {
		name: 'null3d-addon-sizes',
		enforce: 'pre',
		load(/** @type {string} */ id) {
			return WGSL_IMPORT.test(id) ? 'export default {};' : undefined;
		},
	};
}

/**
 * Builds the add-on's entry with the null3D plugin, which compiles its WGSL for WebGPU and WebGL2,
 * and gives the size of each file that the build wrote. The engine and every other null3D package
 * stay external, since a page loads them as dependencies of their own: the sizes are the add-on's
 * own. A second build answers each WGSL import with an empty module. It gives each file's code
 * alone, so the size gate can tell that code from the compiled WGSL inlined beside it.
 *
 * @param {string} folder
 * @param {string} entry
 * @returns {Promise<{ files?: BuiltFileSize[], missing?: string, error?: string }>}
 */
export async function buildAddon(folder, entry) {
	const tools = buildTools(folder);
	if (tools === undefined)
		return { missing: 'vite or @null3d/vite-plugin is not installed beside the add-on' };
	try {
		const { build } = await import(pathToFileURL(tools.vite).href);
		const plugin = await import(pathToFileURL(tools.plugin).href);
		const outputsOf = async (/** @type {unknown[]} */ plugins) => {
			const result = await build({
				configFile: false,
				root: folder,
				logLevel: 'silent',
				plugins: /** @type {never[]} */ (plugins),
				build: {
					write: false,
					minify: true,
					lib: { entry, formats: ['es'], fileName: 'addon' },
					rollupOptions: { external: ADDON_EXTERNALS },
				},
			});
			return /** @type {unknown[]} */ (Array.isArray(result) ? result : [result]);
		};
		const written = (/** @type {unknown[]} */ outputs) => {
			/** @type {BuiltOutput[]} */
			const files = [];
			for (const output of outputs) {
				const parts = /** @type {{ output?: unknown[] }} */ (output).output ?? [];
				for (const part of parts) {
					const file =
						/** @type {{ type?: string, fileName?: string, code?: string, source?: unknown }} */ (
							part
						);
					if (file.type !== 'chunk' && file.type !== 'asset') continue;
					const bytes = Buffer.from(String(file.type === 'chunk' ? file.code : file.source));
					files.push({ name: file.fileName ?? 'addon.js', bytes, text: bytes.toString('utf8') });
				}
			}
			return files;
		};
		const full = written(await outputsOf([plugin.default()]));
		const codeOnly = written(await outputsOf([emptyShaders(), plugin.default()]));
		return { files: splitShaderData(full, codeOnly) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * The size of each file that the build with the plugin wrote, split by what it holds: its own code
 * and the shader data that the plugin inlined in it. `codeOnly` is what the build with the empty
 * WGSL imports wrote. A file that build did not write has no code of its own here, such as a set of
 * builds that the plugin writes apart, so only its whole size is known.
 *
 * @param {readonly BuiltOutput[]} full
 * @param {readonly BuiltOutput[]} codeOnly
 * @returns {BuiltFileSize[]}
 */
export function splitShaderData(full, codeOnly) {
	const code = new Map(codeOnly.map((file) => [file.name, file.bytes]));
	return full.map(({ name, bytes }) => {
		const file = { name, text: bytes.toString('utf8'), ...sizesOf(bytes) };
		const alone = code.get(name);
		if (alone === undefined) return file;
		const size = sizesOf(alone);
		return { ...file, code: size, shader: difference(file, size) };
	});
}

/**
 * One file that a build wrote, before its sizes are measured.
 *
 * @typedef {object} BuiltOutput
 * @property {string} name
 * @property {Buffer} bytes
 * @property {string} [text]
 */

/** The size of `bytes` in each column. */
function sizesOf(/** @type {Buffer} */ bytes) {
	return {
		raw: bytes.length,
		gzip: gzipSync(bytes, { level: 9 }).length,
		brotli: brotliCompressSync(bytes).length,
	};
}

/**
 * The bytes that the shader data adds to a file in each column: the whole file less the same file
 * built without it. A column never reads below zero, so such a column charges those bytes to code.
 */
function difference(/** @type {ByteSize} */ whole, /** @type {ByteSize} */ code) {
	/** @type {ByteSize} */
	const shader = { raw: 0, gzip: 0, brotli: 0 };
	for (const column of COLUMNS) shader[column] = Math.max(0, whole[column] - code[column]);
	return shader;
}

/** A size in KB, to one decimal place. */
const kb = (/** @type {number} */ bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * The budget that a built file answers: the first-use shader budget for a file of compiled shader
 * builds, and the later-file budget for code.
 *
 * @param {string} name
 * @returns {{ raw: number, gzip: number, brotli: number }}
 */
export function budgetOf(name) {
	return SHADER_BUILDS_FILE.test(name) ? ADDON_SHADER_BUDGET : ADDON_FILE_BUDGET;
}

/**
 * The budget problems of the files that a build wrote: one for each column of a file over its
 * budget, and none when every file holds to it. A file of code that holds compiled WGSL answers
 * both budgets. Its own code takes the later-file budget, and the shader data takes the shader one.
 *
 * @param {readonly BuiltFileSize[]} files
 * @returns {string[]}
 */
export function sizeProblems(files) {
	const zero = { raw: 0, gzip: 0, brotli: 0 };
	return files.flatMap((file) => {
		if (budgetOf(file.name) === ADDON_SHADER_BUDGET)
			return overBudget(file.name, '', file, ADDON_SHADER_BUDGET);
		// A file that the build wrote the same without its shader data answers one budget as before.
		if (file.code === undefined || COLUMNS.every((column) => (file.shader?.[column] ?? 0) === 0))
			return overBudget(file.name, '', file, ADDON_FILE_BUDGET);
		return [
			...overBudget(file.name, ' of code', file.code, ADDON_FILE_BUDGET),
			...overBudget(file.name, ' of shader data', file.shader ?? zero, ADDON_SHADER_BUDGET),
		];
	});
}

/**
 * A problem for each column of `size` over `budget`, and none when it holds to it. `part` names
 * what of the file the size is, such as ` of code`, or is empty for the whole file.
 *
 * @param {string} name
 * @param {string} part
 * @param {ByteSize} size
 * @param {ByteSize} budget
 * @returns {string[]}
 */
function overBudget(name, part, size, budget) {
	return COLUMNS.filter((column) => size[column] > budget[column]).map(
		(column) =>
			`${name} is ${kb(size[column])} ${column}${part}, over its ${kb(budget[column])} budget`,
	);
}

/**
 * The size of a group of built files, as its largest in each column. `part` picks what of a file
 * the size is: the whole file, or its own code without the shader data inlined beside it.
 *
 * @param {readonly BuiltFileSize[]} files
 * @param {'all' | 'code'} [part]
 * @returns {string}
 */
function largestSizes(files, part = 'all') {
	const sizeOf = (/** @type {BuiltFileSize} */ file) =>
		part === 'code' ? (file.code ?? file) : file;
	const largest = (/** @type {'raw' | 'gzip' | 'brotli'} */ column) =>
		Math.max(0, ...files.map((file) => sizeOf(file)[column]));
	return `${kb(largest('raw'))} raw, ${kb(largest('gzip'))} gzip, ${kb(largest('brotli'))} brotli`;
}

/**
 * The sizes gate's result: PASS when every file that the build wrote holds to its budget, and WARN
 * when one goes over. The three size budgets are the code budget, the later-file budget and the
 * shader-data budget. An add-on is a choice, so a file over one of them warns rather than fails the
 * check (owner's ruling). The page, cost and allocation gates still fail.
 *
 * @param {readonly BuiltFileSize[]} files
 * @returns {Outcome}
 */
export function sizeOutcome(files) {
	const over = sizeProblems(files);
	const shaderBuilds = files.filter((file) => budgetOf(file.name) === ADDON_SHADER_BUDGET);
	const code = files.filter((file) => budgetOf(file.name) === ADDON_FILE_BUDGET);
	const split = code.filter((file) => (file.shader?.raw ?? 0) > 0);
	const inlined = split.reduce((sum, file) => sum + (file.shader?.raw ?? 0), 0);
	/** What the gate adds to the plain line about a file that holds shader data. */
	const notes = [];
	if (inlined > 0 || shaderBuilds.length > 0) {
		if (code.length > 0) notes.push(`the largest code file at ${largestSizes(code, 'code')}`);
		if (shaderBuilds.length > 0)
			notes.push(`the largest shader build at ${largestSizes(shaderBuilds)}`);
		if (inlined > 0)
			notes.push(
				`${kb(inlined)} of shader data inlined in ${counted(split.length, 'code file')}, within the shader budget`,
			);
	}
	if (over.length > 0)
		return {
			status: 'WARN',
			text: `sizes: ${counted(over.length, 'file')} load more than the budget for a file after the start`,
			details: over,
		};
	return {
		status: 'PASS',
		text:
			notes.length === 0
				? `sizes: the largest file is ${largestSizes(files)}, within budget`
				: `sizes: ${counted(files.length, 'file')} within budget, ${notes.join(', ')}`,
		details: split.map(
			(file) =>
				`${file.name}: ${kb(file.raw)} in all, ${kb(file.code?.raw ?? 0)} of code and ${kb(file.shader?.raw ?? 0)} of shader data, which adds ${kb(file.shader?.gzip ?? 0)} gzip and ${kb(file.shader?.brotli ?? 0)} brotli`,
		),
	};
}

/** How many more lines than `SHOWN_LINES` a message printed, as a note, or nothing. */
function moreLines(/** @type {string[]} */ lines) {
	return lines.length > SHOWN_LINES
		? [`... ${counted(lines.length - SHOWN_LINES, 'more line')}`]
		: [];
}

/** The quality presets that the cost gate measures, lowest first. */
const PRESETS = /** @type {const} */ (['low', 'medium', 'high', 'ultra']);

/** The gates that open a browser, which the page's config or an option can leave out. */
const BROWSER_GATES = ['page', 'cost', 'allocation'];

/** The headers that make a page cross-origin isolated, which its worker threads need. */
const ISOLATION = {
	'cross-origin-opener-policy': 'same-origin',
	'cross-origin-embedder-policy': 'require-corp',
};

/** The media type of each kind of file that a build writes. */
const MEDIA = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.wasm': 'application/wasm',
	'.json': 'application/json',
	'.css': 'text/css',
	'.ktx2': 'image/ktx2',
	'.glb': 'model/gltf-binary',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
};

/**
 * The policy that a page needs when its engine and add-on files come from another origin, as the
 * hosting guide states it.
 *
 * @param {string} cdn
 */
const cdnPolicy = (cdn) =>
	[
		"default-src 'self'",
		`script-src 'self' ${cdn} 'wasm-unsafe-eval'`,
		`worker-src 'self' blob: ${cdn}`,
		`connect-src 'self' ${cdn} data:`,
		`img-src 'self' ${cdn} data: blob:`,
		`font-src 'self' ${cdn} data:`,
		"style-src 'self' 'unsafe-inline'",
	].join('; ');

/**
 * The page that the browser gates open: the one that the caller names, or the first test of the
 * project's config. Gives the reason when there is none.
 *
 * @param {string} folder
 * @param {string | undefined} asked
 * @returns {{ page?: string, reason?: string }}
 */
export function pageOf(folder, asked) {
	if (asked !== undefined) return { page: asked };
	const config = readTestConfig(folder);
	if (config === null) return { reason: 'the folder has no null3d.json, and --page names no page' };
	if (config.problems.length > 0)
		return { reason: `null3d.json has a problem: ${config.problems[0] ?? ''}` };
	const page = config.tests[0]?.page;
	if (page === undefined)
		return { reason: 'the first test in null3d.json names no page, and --page names none' };
	return { page };
}

/**
 * Starts the add-on's page from another origin, under the strict policy and headers that the
 * hosting guide states, once with the isolation headers and once without them.
 *
 * @param {Runner} runner
 * @param {string} page The page, from the build's root.
 * @returns {Promise<Outcome>}
 */
async function strictPolicyGate(runner, page) {
	const folder = runner.server.buildDir;
	if (folder === undefined)
		return { status: 'FAIL', text: 'page: the project has no production build' };
	const pagePath = decodeURIComponent(new URL(page, 'http://page').pathname);
	const file = join(folder, pagePath.endsWith('/') ? `${pagePath}index.html` : pagePath);
	if (!existsSync(file))
		return { status: 'FAIL', text: `page: the production build has no ${page}` };
	const held = readFileSync(file, 'utf8');
	/** @type {ReturnType<typeof createServer> | undefined} */
	let server;
	let isolated = true;
	let cdn = '';
	let body = held;
	try {
		server = createServer((request, response) => {
			try {
				const host = (request.headers.host ?? '').replace(/:\d+$/, '');
				const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
				if (host === 'localhost') {
					// The page's own origin serves the page, and nothing else.
					if (path !== pagePath && !(pagePath === '/index.html' && path === '/')) {
						response.statusCode = 404;
						response.end();
						return;
					}
					response.setHeader('content-type', 'text/html');
					response.setHeader('content-security-policy', cdnPolicy(cdn));
					for (const [name, value] of Object.entries(isolated ? ISOLATION : {}))
						response.setHeader(name, value);
					response.end(body);
					return;
				}
				const target = resolve(join(folder, path));
				if (!`${target}${sep}`.startsWith(`${resolve(folder)}${sep}`)) throw new Error('outside');
				const content = readFileSync(target);
				const type = /** @type {Record<string, string>} */ (MEDIA)[extname(path)];
				response.setHeader('content-type', type ?? 'application/octet-stream');
				response.setHeader('access-control-allow-origin', '*');
				response.end(content);
			} catch {
				response.statusCode = 404;
				response.end();
			}
		});
		// Both host names answer on this one port: the page's origin and the origin of its files.
		await new Promise((/** @type {(v?: unknown) => void} */ resolve) => {
			server?.listen(0, () => resolve());
		});
		const address = server.address();
		const port = typeof address === 'object' && address !== null ? address.port : 0;
		const pageOrigin = `http://localhost:${port}`;
		cdn = `http://127.0.0.1:${port}`;
		// The build's own files load from the other origin, as they do from a CDN.
		body = held.split('"/assets/').join(`"${cdn}/assets/`);
		/** @type {string[]} */
		const failures = [];
		for (const mode of /** @type {const} */ (['threaded', 'single-threaded'])) {
			isolated = mode === 'threaded';
			const path = isolated ? holdPath(page, {}) : `${holdPath(page, {})}&threads=off`;
			const visit = await visitPage(
				{
					server: {
						url: `${pageOrigin}/`,
						errors: [],
						hasFile: (/** @type {string} */ path) => existsSync(join(folder, path)),
						close: async () => {},
					},
					browser: runner.browser,
					environment: runner.environment,
					browserName: runner.browserName,
					close: async () => {},
				},
				{ path, size: [1280, 720], timeoutMs: 60_000 },
				async (browserPage, _errors, url, timeoutMs) => {
					await browserPage.goto(url);
					return holdResult(browserPage, timeoutMs);
				},
			);
			const result = /** @type {HoldFailure | { ok: true }} */ (visit.result);
			if (result.ok !== true) failures.push(`${mode}: ${result.error}`);
			else if (visit.errors.length > 0) failures.push(`${mode}: ${visit.errors[0] ?? ''}`);
		}
		return failures.length === 0
			? {
					status: 'PASS',
					text: 'page: the page starts from another origin under the strict policy, threaded and single-threaded',
				}
			: { status: 'FAIL', text: 'page: the strict policy stopped the page', details: failures };
	} catch (error) {
		return {
			status: 'FAIL',
			text: `page: the strict-policy start failed: ${error instanceof Error ? error.message : error}`,
		};
	} finally {
		await new Promise((resolve) =>
			server ? server.close(() => resolve(undefined)) : resolve(undefined),
		);
	}
}

/**
 * Measures the page's cost on each quality preset, on a production build.
 *
 * @param {Runner} runner
 * @param {string} page
 * @returns {Promise<Outcome>}
 */
async function costGate(runner, page) {
	/** @type {{ preset: string, gpuMs: number | null, cpuMs: number }[]} */
	const costs = [];
	for (const preset of PRESETS) {
		const context = await runner.browser.newContext({
			viewport: { width: 1280, height: 720 },
			deviceScaleFactor: 1,
			ignoreHTTPSErrors: true,
		});
		try {
			const browserPage = await context.newPage();
			const url = new URL(switchedPath(page, { bench: '', preset }), runner.server.url).href;
			// The bench command's own protocol: a short one drew no frame on a cold browser.
			const run = await measurePage(browserPage, url, 60_000, {
				warmupSeconds: WARMUP_SECONDS,
				measureSeconds: MEASURE_SECONDS,
			});
			if (!('ok' in run) || run.ok !== true)
				return {
					status: 'FAIL',
					text: `cost: the page did not measure on ${preset}: ${run.error}`,
				};
			costs.push({ preset, gpuMs: run.stats?.gpuMs?.median ?? null, cpuMs: run.cpuMs.median });
		} finally {
			await context.close();
		}
	}
	const shown = costs.map(
		(cost) =>
			`${cost.preset} ${cost.gpuMs === null ? `${cost.cpuMs.toFixed(2)} ms of CPU time` : `${cost.gpuMs.toFixed(2)} ms of GPU time`}`,
	);
	const timed = costs.every((cost) => cost.gpuMs !== null);
	return {
		status: 'PASS',
		text: `cost per preset: ${shown.join(', ')} per frame, on ${runner.browserName}`,
		details: timed ? [] : ['The device timed no GPU work, so those figures are CPU time.'],
	};
}

/**
 * The workers that the allocation gate samples, by a part of their script's address. The engine
 * runs the page's frame code in the sketch worker, and draws in the render worker.
 */
const SAMPLED_WORKERS = ['sketch-worker', 'render-worker'];

/** Bytes between the heap profiler's samples, small so that a few bytes per frame still show. */
const SAMPLING_INTERVAL = 128;

/**
 * The most objects that one worker's profile may hold in one sample. The profiler records one
 * sample for each stretch of bytes that a page allocates, so a page that allocates fast would
 * otherwise grow a profile until the memory runs out. The gate learns the page's rate first, then
 * widens the interval to hold this count, which keeps one sample at about 20 MB.
 */
export const MAX_ALLOCATION_SAMPLES = 250_000;

/**
 * The coarsest interval that the gate sets. At this interval and the count above, a sample holds
 * any page's allocations up to a few terabytes in its window, so the count holds for every page.
 */
const COARSEST_SAMPLING_INTERVAL = 16 * 1024 * 1024;

/**
 * Milliseconds of the page's frames that the gate samples to learn its allocation rate, and the
 * bytes between those samples, coarse so that the rate's own profile stays small.
 */
const RATE_SAMPLE_MS = 250;
const RATE_SAMPLING_INTERVAL = 8192;

/** Seconds that a page warms up before a sample, so the browser optimizes its frame code. */
const ALLOCATION_WARMUP_SECONDS = 20;

/**
 * Frames that a page draws before a sample too. The browser optimizes code that runs once a frame
 * only after many frames, and until then the numbers that such code computes are allocated.
 */
const ALLOCATION_WARMUP_FRAMES = 1200;

/** Samples that the gate takes one after another, and the seconds that each runs. */
const ALLOCATION_SAMPLES = 2;
const ALLOCATION_SAMPLE_SECONDS = 4;

/** Seconds without a new frame after which the gate gives up on a page that stopped drawing. */
const STALL_SECONDS = 60;

/** How many places of the add-on's own code a result names. */
const SHOWN_PLACES = 8;

/**
 * Milliseconds that a CPU profile of the workers runs. The heap profile lists only the places that
 * allocated; this profile lists the functions that ran, so the gate can tell whether it saw the
 * add-on's own code at all.
 */
const CPU_PROFILE_MS = 1000;

/** The global where the gate counts a page's animation frames. */
const FRAME_COUNTER = '__null3dAddonFrames';

/** How long a page may take to start the engine. */
const ENGINE_TIMEOUT_MS = 60_000;

/**
 * The figures of one page on one quality preset.
 *
 * @typedef {object} AllocationFigures
 * @property {number} pageBytes Bytes per frame in the page's threads.
 * @property {number} addonBytes Bytes per frame in the add-on's own code.
 * @property {boolean} addonRan Whether the workers ran any of the add-on's own code.
 * @property {{ worker: string, place: string, perFrame: number }[]} places The places of the
 *   add-on's own code that allocated, largest first.
 */

/**
 * Runs in the page: counts the browser's animation frames under `name`, from now on.
 *
 * @param {string} name
 */
function startCountingFrames(name) {
	const scope =
		/** @type {{ requestAnimationFrame: (callback: () => void) => number } & Record<string, unknown>} */ (
			/** @type {unknown} */ (globalThis)
		);
	if (scope[name]) return;
	const counter = { frames: 0 };
	const tick = () => {
		counter.frames++;
		scope.requestAnimationFrame(tick);
	};
	scope.requestAnimationFrame(tick);
	scope[name] = counter;
}

/**
 * Runs in the page: the animation frames counted since the counter started.
 *
 * @param {string} name
 * @returns {number}
 */
function countedFrames(name) {
	const counter = /** @type {{ frames: number } | undefined} */ (
		/** @type {Record<string, unknown>} */ (globalThis)[name]
	);
	return counter?.frames ?? 0;
}

/**
 * The file of a named frame, as a path, or nothing for a frame of the browser or of a script with no
 * address of its own.
 *
 * @param {CallFrame} frame
 * @returns {string | undefined}
 */
function sourcePathOf({ url }) {
	if (!/^https?:/.test(url)) return undefined;
	try {
		return decodeURIComponent(new URL(url).pathname);
	} catch {
		return undefined;
	}
}

/**
 * Something that names a frame through a build's source maps, such as a `BuildNames`.
 *
 * @typedef {{ name: (frame: CallFrame) => CallFrame }} Namer
 */

/**
 * An add-on's package name and its folder, with symbolic links resolved.
 *
 * @typedef {{ folder: string, name: string }} Addon
 */

/**
 * Whether a source file is the add-on's own: in its folder, as a page that imports its source uses
 * it, or in its copy under `node_modules`, as a page that imports the published package uses it.
 *
 * @param {string} path
 * @param {Addon} addon
 * @returns {boolean}
 */
function belongsToAddon(path, { folder, name }) {
	return `${path}${sep}`.startsWith(`${folder}${sep}`) || path.includes(`/node_modules/${name}/`);
}

/**
 * Names each function of a profile through the build's source maps, and notes each place that the
 * add-on's own code allocated in. A place belongs to the add-on when its source file is the
 * add-on's, so the gate names the page's and the add-on's code, not the engine's.
 *
 * @param {ProfileNode} node
 * @param {Namer} names
 * @param {Addon} addon
 * @param {Set<string>} into
 */
export function nameProfile(node, names, addon, into) {
	node.callFrame = names.name(node.callFrame);
	const path = sourcePathOf(node.callFrame);
	if (path !== undefined && belongsToAddon(path, addon)) into.add(placeName(node.callFrame));
	for (const child of node.children) nameProfile(child, names, addon, into);
}

/**
 * Whether any of the frames that the workers ran comes from the add-on's own code. A page that runs
 * none of it is the wrong page to measure, whatever its profile holds.
 *
 * @param {readonly CallFrame[]} frames
 * @param {Namer} names
 * @param {Addon} addon
 * @returns {boolean}
 */
export function ranAddonCode(frames, names, addon) {
	for (const frame of frames) {
		const path = sourcePathOf(names.name(frame));
		if (path !== undefined && belongsToAddon(path, addon)) return true;
	}
	return false;
}

/**
 * The bytes between samples that keep one worker's profile under `MAX_ALLOCATION_SAMPLES`, for a
 * page that allocates `bytesPerSecond`. A page that allocates slowly takes the finest interval, so
 * a few bytes per frame still show; a faster page is sampled less finely, and its places are
 * coarser.
 *
 * @param {number} bytesPerSecond
 * @returns {number}
 */
export function samplingIntervalFor(bytesPerSecond) {
	const wanted = Math.ceil((bytesPerSecond * ALLOCATION_SAMPLE_SECONDS) / MAX_ALLOCATION_SAMPLES);
	return Math.min(COARSEST_SAMPLING_INTERVAL, Math.max(SAMPLING_INTERVAL, wanted));
}

/**
 * The bytes that the page's workers allocate each second, from a short sample at a coarse interval.
 *
 * @param {HeapSampler} sampler
 * @param {() => Promise<number>} frames
 * @returns {Promise<number>}
 */
async function allocationRate(sampler, frames) {
	await sampler.start(RATE_SAMPLING_INTERVAL);
	const start = await frames();
	await sleep(RATE_SAMPLE_MS);
	const profiles = await sampler.stop();
	if ((await frames()) - start <= 0) return 0;
	let bytes = 0;
	for (const profile of profiles.values()) bytes += totalSize(profile.head);
	return bytes / (RATE_SAMPLE_MS / 1000);
}

/**
 * Waits until a page's frame counter reaches `target`, and throws when it stands still for a while,
 * as on a page whose engine failed.
 *
 * @param {() => Promise<number>} frames
 * @param {number} target
 */
async function reachFrames(frames, target) {
	let last = -1;
	let still = 0;
	for (;;) {
		const now = await frames();
		if (now >= target) return;
		still = now === last ? still + 1 : 0;
		if (still >= STALL_SECONDS)
			throw new Error(`the page drew no frame for ${STALL_SECONDS} s, at ${now} of ${target}`);
		last = now;
		await sleep(1000);
	}
}

/**
 * The browser's page target at the address that the gate opened, or the newest page at its path for
 * a page that rewrote its address. The address names the preset, so a page that an earlier gate left
 * open does not match it.
 *
 * @param {DevTools} devtools
 * @param {string} url
 * @returns {Promise<TargetInfo | undefined>}
 */
async function pageTargetAt(devtools, url) {
	const { targetInfos } = /** @type {{ targetInfos: TargetInfo[] }} */ (
		await devtools.send('Target.getTargets')
	);
	const exact = targetInfos.filter(
		(target) => target.type === 'page' && target.url.startsWith(url),
	);
	return exact.at(-1) ?? (await pagesAt(devtools, url)).at(-1);
}

/**
 * Opens the page on one quality preset and samples what its workers allocate per frame, then gives
 * the bytes per frame of the add-on's own code and of the page.
 *
 * @param {{ devtools: DevTools, browserPage: Page, url: string, names: Namer, addon: Addon }} options
 * @returns {Promise<AllocationFigures | { error: string }>}
 */
async function sampleAllocation({ devtools, browserPage, url, names, addon }) {
	const started = await pollPage(browserPage, url, ENGINE_TIMEOUT_MS, async (overdue) => {
		const found = await browserPage
			.evaluate((name) => name in globalThis, ENGINE_GLOBAL)
			.catch(() => false);
		if (found) return true;
		if (overdue)
			return failure(
				'the page did not start the engine in time. The allocation gate needs a page that starts the engine as it loads, with no click',
			);
		return undefined;
	});
	if (started !== true) return { error: started.error };
	await browserPage.evaluate(startCountingFrames, FRAME_COUNTER);
	const framesSoFar = () => browserPage.evaluate(countedFrames, FRAME_COUNTER);
	const target = await pageTargetAt(devtools, url);
	if (target === undefined) return { error: 'the browser reported no page for this address' };
	const { workers } = await attachWorkers(devtools, target.targetId, SAMPLED_WORKERS);
	await sleep(ALLOCATION_WARMUP_SECONDS * 1000);
	await reachFrames(framesSoFar, ALLOCATION_WARMUP_FRAMES);
	const ran = await sampledFrames(devtools, workers, CPU_PROFILE_MS);
	const addonRan = [...ran.values()].some((frames) => ranAddonCode(frames, names, addon));
	const sampler = new HeapSampler(devtools, workers);
	await sampler.enable();
	const interval = samplingIntervalFor(await allocationRate(sampler, framesSoFar));
	/** @type {Map<string, Sample[]>} */
	const samples = new Map();
	/** @type {Map<string, number>} */
	const bytes = new Map();
	/** @type {Set<string>} */
	const addonPlaces = new Set();
	let frames = 0;
	for (let sample = 0; sample < ALLOCATION_SAMPLES; sample++) {
		await sampler.start(interval);
		const startFrames = await framesSoFar();
		await sleep(ALLOCATION_SAMPLE_SECONDS * 1000);
		const profiles = await sampler.stop();
		const drawn = (await framesSoFar()) - startFrames;
		if (drawn <= 0) return { error: 'the page drew no frame while it was sampled' };
		frames += drawn;
		for (const [worker, profile] of profiles) {
			nameProfile(profile.head, names, addon, addonPlaces);
			samples.set(worker, [
				...(samples.get(worker) ?? []),
				{ places: profilePlaces(profile), frames: drawn },
			]);
			bytes.set(worker, (bytes.get(worker) ?? 0) + totalSize(profile.head));
		}
	}
	const unsampled = [...samples.keys()].filter((worker) => !bytes.get(worker));
	if (unsampled.length > 0)
		return {
			error: `the heap profiler sampled nothing in the ${unsampled.join(' and the ')}. Its page must run the engine's sketch and render workers`,
		};
	/** @type {{ worker: string, place: string, perFrame: number }[]} */
	const places = [];
	for (const [worker, workerSamples] of samples)
		for (const [place, { perFrame }] of steadyPlaces(workerSamples))
			if (addonPlaces.has(place)) places.push({ worker, place, perFrame });
	places.sort((a, b) => b.perFrame - a.perFrame);
	return {
		addonBytes: places.reduce((sum, place) => sum + place.perFrame, 0),
		pageBytes: [...bytes.values()].reduce((sum, size) => sum + size, 0) / frames,
		addonRan,
		places,
	};
}

/** The size of a figure per frame: whole bytes below one kilobyte, and kilobytes above it. */
const perFrameSize = (/** @type {number} */ bytes) =>
	bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${Math.round(bytes)} bytes`;

/**
 * What the allocation gate prints: the bytes per frame in the add-on's own code on each preset,
 * then the page's own figure and the places that allocated on each.
 *
 * @param {readonly ({ preset: string } & AllocationFigures)[]} runs
 * @param {string} browserName
 * @returns {Outcome}
 */
export function allocationOutcome(runs, browserName) {
	const shown = runs.map((run) => `${run.preset} ${perFrameSize(run.addonBytes)}`);
	/** @type {string[]} */
	const details = runs.map(
		(run) =>
			`${run.preset}: ${perFrameSize(run.pageBytes)} per frame in the page's threads, ${perFrameSize(run.addonBytes)} of it in the add-on's own code`,
	);
	for (const run of runs)
		for (const { worker, place, perFrame } of run.places.slice(0, SHOWN_PLACES))
			details.push(`${run.preset}: ${perFrameSize(perFrame)} per frame in ${place} (${worker})`);
	return {
		status: 'PASS',
		text: `allocation per preset: ${shown.join(', ')} per frame in the add-on's own code, on ${browserName}`,
		details,
	};
}

/**
 * Measures what the add-on's own code allocates per frame on the page, on each quality preset. The
 * page runs its production build, as the cost gate measures it, and the gate samples the sketch and
 * render workers' heaps. A page that the gate cannot measure fails; a figure that a seller publishes
 * for its add-on never does.
 *
 * @param {Runner} runner
 * @param {{ page: string, folder: string, name: string }} options The page, from the project's
 *   root, and the add-on that it belongs to.
 * @param {number} port The port of the browser's debugging socket.
 * @param {number} [timeoutMs] How long the browser may take to answer on that port.
 * @returns {Promise<Outcome>}
 */
export async function allocationGate(runner, { page, folder, name }, port, timeoutMs = 20_000) {
	const buildDir = runner.server.buildDir;
	if (buildDir === undefined)
		return { status: 'FAIL', text: 'allocation: the project has no production build' };
	/** @type {DevTools} */
	let devtools;
	try {
		devtools = await DevTools.connect(port, timeoutMs);
	} catch (error) {
		return {
			status: 'FAIL',
			text: `allocation: the gate could not reach the browser's debugging socket: ${error instanceof Error ? error.message : error}`,
		};
	}
	const names = new BuildNames(buildDir);
	// A build names the sources by the path that Vite resolved, and a symbolic link in the folder's
	// own path would hide the add-on's code from the gate.
	/** @type {Addon} */
	const addon = { name, folder };
	try {
		addon.folder = realpathSync(folder);
	} catch {
		addon.folder = folder;
	}
	try {
		/** @type {({ preset: string } & AllocationFigures)[]} */
		const runs = [];
		for (const preset of PRESETS) {
			const context = await runner.browser.newContext({
				viewport: { width: 1280, height: 720 },
				deviceScaleFactor: 1,
				ignoreHTTPSErrors: true,
			});
			try {
				const browserPage = await context.newPage();
				const url = new URL(switchedPath(page, { bench: '', preset }), runner.server.url).href;
				const run = await sampleAllocation({ devtools, browserPage, url, names, addon });
				if ('error' in run)
					return { status: 'FAIL', text: `allocation: on ${preset}, ${run.error}` };
				runs.push({ preset, ...run });
			} finally {
				await context.close();
			}
		}
		if (!runs.some((run) => run.addonRan))
			return {
				status: 'FAIL',
				text: `allocation: the page ran none of the add-on's own code on any preset, so the gate measured other code. Make the page use the add-on, and check that its files come from the add-on's folder or its installed package`,
			};
		return allocationOutcome(runs, runner.browserName);
	} catch (error) {
		return {
			status: 'FAIL',
			text: `allocation: the gate stopped: ${error instanceof Error ? error.message : error}`,
		};
	} finally {
		devtools.close();
	}
}

/**
 * Runs the command with its arguments, prints each gate as it comes and a count at the end, and
 * returns the exit code: 0 when no gate failed, 1 when one did.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const options = parseCheckAddonArgs(args);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	const folder = resolve(options.folder);
	/** @type {Outcome[]} */
	const outcomes = [];
	const print = (/** @type {Outcome} */ outcome) => {
		outcomes.push(outcome);
		console.log(outcomeText(outcome));
	};
	const addon = readAddon(folder);
	if (addon.problems.length > 0 || addon.entry === undefined || addon.name === undefined) {
		print({
			status: 'FAIL',
			text: `package: ${addon.problems[0] ?? 'no entry file'}`,
			details: addon.problems.slice(1),
		});
		console.log(summaryLine(outcomes));
		return 1;
	}
	print({ status: 'PASS', text: `package: ${addon.name}` });

	const api = publicApiProblems(folder);
	print(
		api.problems.length === 0
			? {
					status: 'PASS',
					text: `public API: ${counted(api.files, 'file')} import${api.files === 1 ? 's' : ''} only the engine's public entry points`,
				}
			: {
					status: 'FAIL',
					text: `public API: ${counted(api.problems.length, 'import')} ${api.problems.length === 1 ? 'reaches' : 'reach'} past the engine's public entry points`,
					details: api.problems,
				},
	);

	const engine = engineVersions(folder);
	if (engine === undefined) {
		print({ status: 'SKIP', text: 'interface: the null3D engine was not found beside the add-on' });
	} else {
		const result = interfaceResult(addon.name, addon.entry, engine);
		print(
			result.problem === undefined
				? { status: 'PASS', text: `interface: ${result.text}` }
				: { status: 'FAIL', text: `interface: ${addon.name} ${result.problem}` },
		);
	}

	const built = await buildAddon(folder, addon.entry);
	if (built.missing !== undefined) {
		print({ status: 'SKIP', text: `shaders: ${built.missing}` });
		print({ status: 'SKIP', text: `sizes: the build that measures them did not run` });
	} else if (built.error !== undefined) {
		const lines = built.error.split('\n').filter((line) => line.trim() !== '');
		print({
			status: 'FAIL',
			text: 'shaders: the build failed, so its WGSL compiled for neither GPU path',
			details: [...lines.slice(0, SHOWN_LINES), ...moreLines(lines)],
		});
		print({ status: 'SKIP', text: `sizes: the build that measures them did not run` });
	} else {
		const files = built.files ?? [];
		print({
			status: 'PASS',
			text: `shaders: ${counted(files.length, 'file')} built with WGSL for WebGPU and WebGL2`,
		});
		print(sizeOutcome(files));
	}

	if (options.skipBrowser) {
		for (const gate of BROWSER_GATES)
			print({ status: 'SKIP', text: `${gate}: --skip-browser runs no gate that opens a browser` });
	} else {
		const chosen = pageOf(folder, options.page);
		if (chosen.page === undefined) {
			print({ status: 'SKIP', text: `page: ${chosen.reason ?? ''}` });
			print({ status: 'SKIP', text: 'cost: there is no page to measure' });
			print({ status: 'SKIP', text: 'allocation: there is no page to sample' });
		} else {
			/** @type {Runner | undefined} */
			let runner;
			// The browser tools build and serve the project in the current folder.
			const cwd = process.cwd();
			try {
				process.chdir(folder);
				// The allocation gate reads the workers' heaps through the browser's debugging socket.
				const port = await freePort();
				runner = await startRunner({
					production: true,
					sourcemap: true,
					// The engine's shader builds come from the shared shader set as files, so the page's
					// build passes none of their bytes through the bundler.
					linkedShaders: true,
					browserArgs: [WEBGPU_DEVELOPER_FEATURES, `--remote-debugging-port=${port}`],
				});
				print(await strictPolicyGate(runner, chosen.page));
				if (options.skipCost)
					print({
						status: 'SKIP',
						text: 'cost: --skip-cost runs no cost measurement, because a loaded machine reports its load',
					});
				else print(await costGate(runner, chosen.page));
				print(await allocationGate(runner, { page: chosen.page, folder, name: addon.name }, port));
			} catch (error) {
				print({
					status: 'FAIL',
					text: `page: the browser gates stopped: ${error instanceof Error ? error.message : error}`,
				});
			} finally {
				await runner?.close();
				process.chdir(cwd);
			}
		}
	}

	console.log(summaryLine(outcomes));
	return outcomes.some((outcome) => outcome.status === 'FAIL') ? 1 : 0;
}
