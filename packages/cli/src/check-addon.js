// null3d check-addon: runs the engine's gates on one add-on package, so its author and a listing
// see the same checks the engine's own add-ons answer. The gates run on the package in a folder:
// the entry points that its shipped code imports, the plugin interface that it declares, a build
// that compiles its shaders for WebGPU and WebGL2, and the sizes of the files it loads after the
// start. With a page in the project's config, a browser opens that page for the remaining gates.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { readArguments, UsageError } from './args.js';
import { measurePage } from './bench.js';
import { WEBGPU_DEVELOPER_FEATURES } from './browser.js';
import { holdPath, holdResult, switchedPath } from './page.js';
import { MEASURE_SECONDS, WARMUP_SECONDS } from './protocol.js';
import { startRunner, visitPage } from './runner.js';
import { outcomeText, summaryLine } from './test.js';
import { readTestConfig } from './test-config.js';
import { counted } from './text.js';

/** @import { Outcome } from './project-checks.js' */
/** @import { HoldFailure } from './page.js' */
/** @import { Runner } from './runner.js' */

/** The file that names an add-on's package, in its folder. */
const MANIFEST = 'package.json';

/** The engine's entry points that an add-on may import. */
const PUBLIC_ENTRIES = new Set(['@null3d/engine', '@null3d/engine/stats']);

/** The engine's entry-point prefix. */
const ENGINE_ENTRY = '@null3d/engine';

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

/** The budget of each column for a file that an add-on loads after the start (D-14). */
export const ADDON_FILE_BUDGET = { raw: 64 * 1024, gzip: 24 * 1024, brotli: 17 * 1024 };

/**
 * The budget of each column for a built file that holds compiled shader builds (D-14, D-215). The
 * plugin puts custom materials' builds in files of their own, which a page loads on the material's
 * first use. They are shader data, so they take the first-use shader budget rather than the code
 * budget above. The engine's size report keeps the same figures for its own first-use shader files,
 * and a test keeps these equal to that report's.
 */
export const ADDON_SHADER_BUDGET = { raw: 1792 * 1024, gzip: 320 * 1024, brotli: 52 * 1024 };

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
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli check-addon [folder] [options]

Runs the engine's gates on one add-on package, in \`folder\` (the current folder without one):
  public API   the shipped code imports only @null3d/engine and @null3d/engine/stats
  interface    the entry declares the plugin interface that it works with, or, for a null3D
               package, pins the engine version
  shaders      a build compiles the add-on's WGSL for WebGPU and WebGL2
  sizes        each file that the add-on loads after the start holds to its budget
  page         with a page, it starts from another origin under the strict policy, allocates
               nothing in a frame, and its cost is measured on each quality preset

The page comes from \`page\` in the first test of null3d.json, or from --page. Without one, the
page gates are skipped.

Options:
  --page <path>       The page to open, from the project's root, such as /demo.html, instead of
                      the config's
  --skip-browser      Run no gate that opens a browser
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
 * One file that a build wrote, with its size in each column.
 *
 * @typedef {object} BuiltFileSize
 * @property {string} name
 * @property {number} raw
 * @property {number} gzip
 * @property {number} brotli
 */

/**
 * Builds the add-on's entry with the null3D plugin, which compiles its WGSL for WebGPU and WebGL2,
 * and gives the size of each file that the build wrote. The engine stays external: the sizes are
 * the add-on's own.
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
		const result = await build({
			configFile: false,
			root: folder,
			logLevel: 'silent',
			plugins: [plugin.default()],
			build: {
				write: false,
				minify: true,
				lib: { entry, formats: ['es'], fileName: 'addon' },
				rollupOptions: { external: [/^@null3d\/engine(?:\/stats)?$/] },
			},
		});
		const outputs = /** @type {unknown[]} */ (Array.isArray(result) ? result : [result]);
		/** @type {BuiltFileSize[]} */
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
				files.push({
					name: file.fileName ?? 'addon.js',
					raw: bytes.length,
					gzip: gzipSync(bytes, { level: 9 }).length,
					brotli: brotliCompressSync(bytes).length,
				});
			}
		}
		return { files };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
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
 * budget, and none when every file holds to it.
 *
 * @param {readonly BuiltFileSize[]} files
 * @returns {string[]}
 */
export function sizeProblems(files) {
	return files.flatMap((file) => {
		const budget = budgetOf(file.name);
		return COLUMNS.filter((column) => file[column] > budget[column]).map(
			(column) =>
				`${file.name} is ${kb(file[column])} ${column}, over its ${kb(budget[column])} budget`,
		);
	});
}

/**
 * The size of a group of built files, as its largest in each column.
 *
 * @param {readonly BuiltFileSize[]} files
 * @returns {string}
 */
function largestSizes(files) {
	const largest = (/** @type {'raw' | 'gzip' | 'brotli'} */ column) =>
		Math.max(0, ...files.map((file) => file[column]));
	return `${kb(largest('raw'))} raw, ${kb(largest('gzip'))} gzip, ${kb(largest('brotli'))} brotli`;
}

/** How many more lines than `SHOWN_LINES` a message printed, as a note, or nothing. */
function moreLines(/** @type {string[]} */ lines) {
	return lines.length > SHOWN_LINES
		? [`... ${counted(lines.length - SHOWN_LINES, 'more line')}`]
		: [];
}

/** The quality presets that the cost gate measures, lowest first. */
const PRESETS = /** @type {const} */ (['low', 'medium', 'high', 'ultra']);

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
		const over = sizeProblems(files);
		const shaderBuilds = files.filter((file) => budgetOf(file.name) === ADDON_SHADER_BUDGET);
		const code = files.filter((file) => budgetOf(file.name) === ADDON_FILE_BUDGET);
		print(
			over.length === 0
				? {
						status: 'PASS',
						text:
							shaderBuilds.length === 0
								? `sizes: the largest file is ${largestSizes(files)}, within budget`
								: `sizes: ${counted(files.length, 'file')} within budget, the largest code file at ${largestSizes(code)}, and the largest shader build at ${largestSizes(shaderBuilds)}`,
					}
				: {
						status: 'FAIL',
						text: `sizes: ${counted(over.length, 'file')} load more than the budget for a file after the start`,
						details: over,
					},
		);
	}

	if (options.skipBrowser) {
		print({ status: 'SKIP', text: 'page: --skip-browser runs no gate that opens a browser' });
	} else {
		const chosen = pageOf(folder, options.page);
		if (chosen.page === undefined) {
			print({ status: 'SKIP', text: `page: ${chosen.reason ?? ''}` });
		} else {
			/** @type {Runner | undefined} */
			let runner;
			// The browser tools build and serve the project in the current folder.
			const cwd = process.cwd();
			try {
				process.chdir(folder);
				runner = await startRunner({
					production: true,
					browserArgs: [WEBGPU_DEVELOPER_FEATURES],
				});
				print(await strictPolicyGate(runner, chosen.page));
				print(await costGate(runner, chosen.page));
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
