// The maths entry, `@null3d/engine/math` and its sub-paths, holds only code that a deterministic
// simulation may run: exact arithmetic, and the helpers that createMath builds on functions that the
// caller gives. These checks bundle a simulation that imports it, as a game's build bundles its
// simulation, and read the bundle for every name that such a simulation may not use. They also hold
// the entry's modules to importing nothing outside the maths folder but the engine's error class, so
// a bundler that keeps a whole module still reaches no page, worker, generated or WebAssembly code,
// and the package's exports map to naming each module's built twin.
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';

const ENGINE = join(import.meta.dirname, '../..');
const FIXTURE = join(import.meta.dirname, '../../../../tests/fixtures/rules-code');

// What a deterministic simulation may not name. The lists are clockwork2's, the engine that the vbz
// platform replays a game's simulation with: `BANNED_GLOBALS`, `BANNED_MEMBERS` and
// `BANNED_PROPERTIES` in its packages/engine/src/validate/scan/banned.ts, at @clockwork2/engine
// 0.9.0. null3D does not depend on that engine, so the names are copied here. A name that its list
// gains belongs here too.
const BANNED_GLOBALS = [
	'Date',
	'performance',
	'setTimeout',
	'setInterval',
	'setImmediate',
	'requestAnimationFrame',
	'requestIdleCallback',
	'queueMicrotask',
	'crypto',
	'Intl',
	'WeakRef',
	'FinalizationRegistry',
	'structuredClone',
	'Atomics',
	'WebAssembly',
	'fetch',
	'XMLHttpRequest',
	'navigator',
	'localStorage',
	'sessionStorage',
	'indexedDB',
	'document',
	'window',
	'Image',
];
/** The members of `Math` in clockwork2's list, which differ between JavaScript engines or hold state. */
const BANNED_MATH = [
	'random',
	'pow',
	'sin',
	'cos',
	'tan',
	'asin',
	'acos',
	'atan',
	'atan2',
	'exp',
	'expm1',
	'log',
	'log2',
	'log10',
	'log1p',
	'cbrt',
	'hypot',
	'sinh',
	'cosh',
	'tanh',
	'asinh',
	'acosh',
	'atanh',
];
const BANNED_PROPERTIES = ['toLocaleString', 'localeCompare', 'sendBeacon'];
/**
 * The members of `Math` that a simulation may read: those that clockwork2's guide names as exact
 * (its AGENTS.md, "Writing simulation code"), and the constants. Every other member, and every use
 * of `Math` but a read of one of these, is refused.
 */
const EXACT_MATH = [
	'sqrt',
	'floor',
	'ceil',
	'round',
	'trunc',
	'abs',
	'min',
	'max',
	'sign',
	'fround',
	'imul',
	'clz32',
	'PI',
	'E',
	'LN2',
	'LN10',
	'LOG2E',
	'LOG10E',
	'SQRT2',
	'SQRT1_2',
];
/**
 * Names that clockwork2's list leaves out, because a simulation could not reach them anyway, and that
 * mark the engine's page and worker code: `eval`, a worker, shared memory and the thread's global
 * object.
 */
const PAGE_AND_WORKER = [
	'eval',
	'Worker',
	'SharedArrayBuffer',
	'importScripts',
	'postMessage',
	'addEventListener',
	'globalThis',
	'self',
	'location',
];

/**
 * Bundles the fixture's simulation as the vbz SDK bundles a game's: `bun build` in the game's
 * folder, for the browser, as an ES module, minified, with only `NODE_ENV=production` in its
 * environment. The source condition makes the bundler read the engine's TypeScript, which the
 * package's build compiles file for file into the JavaScript a game installs.
 */
function bundleSimulation(): string {
	const run = Bun.spawnSync(
		[
			process.execPath,
			'build',
			'./sim.ts',
			'--target=browser',
			'--format=esm',
			'--minify',
			'--conditions=null3d-source',
		],
		{ cwd: FIXTURE, env: { NODE_ENV: 'production' } },
	);
	if (run.exitCode !== 0) throw new Error(`bun build failed:\n${run.stderr.toString()}`);
	return run.stdout.toString();
}

/**
 * The identifier names that read a binding: every identifier but a member's name, a property's
 * key in an object or a pattern, a label, or the names of an import or export specifier.
 */
function readsBinding(id: ts.Identifier): boolean {
	const parent = id.parent;
	if (ts.isPropertyAccessExpression(parent)) return parent.name !== id;
	if (ts.isQualifiedName(parent)) return parent.right !== id;
	if (
		ts.isPropertyAssignment(parent) ||
		ts.isMethodDeclaration(parent) ||
		ts.isPropertyDeclaration(parent) ||
		ts.isGetAccessorDeclaration(parent) ||
		ts.isSetAccessorDeclaration(parent)
	)
		return parent.name !== id;
	if (ts.isBindingElement(parent)) return parent.propertyName !== id;
	return !(
		ts.isLabeledStatement(parent) ||
		ts.isBreakOrContinueStatement(parent) ||
		ts.isImportSpecifier(parent) ||
		ts.isExportSpecifier(parent) ||
		ts.isMetaProperty(parent)
	);
}

/**
 * The names in `code` that a deterministic simulation may not use, each once, in order of use. The
 * TypeScript compiler binds the code's own scopes with no library, so an identifier that resolves to
 * no declaration in the code is a global, and a name that the code declares, at any depth, hides
 * the global only where its scope reaches. `Math` may appear only as `Math.<name>` with a name of
 * `EXACT_MATH`: any other use, such as an alias or a destructuring, could reach every member.
 */
function forbiddenNames(code: string): string[] {
	const name = 'scanned.js';
	const file = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const options: ts.CompilerOptions = { allowJs: true, noLib: true, noResolve: true, types: [] };
	const host = ts.createCompilerHost(options);
	host.getSourceFile = (fileName) => (fileName === name ? file : undefined);
	host.fileExists = (fileName) => fileName === name;
	const checker = ts.createProgram({ rootNames: [name], options, host }).getTypeChecker();
	const isGlobal = (id: ts.Identifier): boolean => {
		const symbol =
			ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
				? checker.getShorthandAssignmentValueSymbol(id.parent)
				: checker.getSymbolAtLocation(id);
		return !symbol?.declarations?.some((declaration) => declaration.getSourceFile() === file);
	};
	const found = new Set<string>();
	const globals = new Set([...BANNED_GLOBALS, ...PAGE_AND_WORKER]);
	const visit = (node: ts.Node): void => {
		if (ts.isBinaryExpression(node)) {
			const kind = node.operatorToken.kind;
			if (
				kind === ts.SyntaxKind.AsteriskAsteriskToken ||
				kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken
			)
				found.add('**');
		} else if (ts.isPropertyAccessExpression(node) && BANNED_PROPERTIES.includes(node.name.text)) {
			found.add(`.${node.name.text}`);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			found.add('import()');
		} else if (ts.isMetaProperty(node)) {
			found.add('import.meta');
		} else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			if (node.moduleSpecifier) found.add(`import of ${node.moduleSpecifier.getText(file)}`);
		} else if (ts.isIdentifier(node) && readsBinding(node) && isGlobal(node)) {
			const parent = node.parent;
			if (node.text === 'Math') {
				const member = ts.isPropertyAccessExpression(parent) ? parent.name.text : undefined;
				if (member === undefined) found.add('Math');
				else if (!EXACT_MATH.includes(member)) found.add(`Math.${member}`);
			} else if (globals.has(node.text)) found.add(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return [...found];
}

/** True for `import.meta.url`, which a `new URL(...)` of a file beside the module takes. */
const isImportMetaUrl = (node: ts.Node | undefined): boolean =>
	node !== undefined &&
	ts.isPropertyAccessExpression(node) &&
	ts.isMetaProperty(node.expression) &&
	node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
	node.name.text === 'url';

/**
 * The specifiers of the files that `file` loads in JavaScript: its import and export declarations
 * other than those of types alone, `import x = require(...)`, every `import(...)` and
 * `require(...)` call anywhere in it, and every `new URL(..., import.meta.url)`, which is how
 * engine code names a worker's script or an asset that the bundler copies beside it. An import of
 * types alone leaves nothing in a bundle. A load that names its file with anything but a string
 * cannot be followed, so it throws.
 */
function loadedModules(file: string, text: string): string[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
	const loaded: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			const typesOnly = ts.isImportDeclaration(node)
				? node.importClause?.isTypeOnly === true
				: node.isTypeOnly;
			if (!typesOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
				loaded.push(node.moduleSpecifier.text);
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			!node.isTypeOnly &&
			ts.isExternalModuleReference(node.moduleReference) &&
			ts.isStringLiteral(node.moduleReference.expression)
		) {
			loaded.push(node.moduleReference.expression.text);
		} else if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === 'require'))
		) {
			const [specifier] = node.arguments;
			if (!specifier || !ts.isStringLiteralLike(specifier))
				throw new Error(`${file} loads a module that it names with no string`);
			loaded.push(specifier.text);
		} else if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'URL' &&
			isImportMetaUrl(node.arguments?.[1])
		) {
			const [specifier] = node.arguments ?? [];
			if (!specifier || !ts.isStringLiteralLike(specifier))
				throw new Error(`${file} loads a module that it names with no string`);
			loaded.push(specifier.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return loaded;
}

/**
 * The files under `root` that `entry` reaches through what it loads in JavaScript, as paths from
 * `root`: the engine's, unless a test names another folder. A TypeScript module is read for what
 * it loads in turn, and any other file, such as a worker's built script or an asset, is listed.
 */
function reachedFiles(entry: string, root = ENGINE): string[] {
	const reached = new Set<string>();
	const walk = (file: string): void => {
		const path = relative(root, file);
		if (reached.has(path)) return;
		reached.add(path);
		for (const specifier of loadedModules(file, readFileSync(file, 'utf8'))) {
			if (!specifier.startsWith('.'))
				throw new Error(`${path} imports ${specifier}, which is not one of the engine's own files`);
			const target = resolve(dirname(file), specifier);
			if (target.endsWith('.ts')) walk(target);
			else if (extname(target) === '') walk(`${target}.ts`);
			else reached.add(relative(root, target));
		}
	};
	walk(join(root, entry));
	return [...reached].sort();
}

/** The package's exports for the maths entry and its sub-paths. */
function mathExports(): [string, Record<string, string>][] {
	const manifest = JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8')) as {
		exports: Record<string, Record<string, string> | string>;
	};
	return Object.entries(manifest.exports)
		.filter(([key]) => key === './math' || key.startsWith('./math/'))
		.map(([key, value]) => [key, value as Record<string, string>]);
}

describe('the maths entry', () => {
	it('names each module of the maths folder, and its built twin for a project that installs it', () => {
		const exports = mathExports();
		expect(exports.map(([key]) => key)).toEqual([
			'./math',
			'./math/vec3',
			'./math/quat',
			'./math/mat4',
			'./math/math',
		]);
		for (const [key, targets] of exports) {
			const source = targets['null3d-source'] as string;
			expect({ key, folder: dirname(source) }).toEqual({ key, folder: './src/math' });
			expect(existsSync(join(ENGINE, source))).toBe(true);
			const built = source.replace(/^\.\/src\//, './lib/').replace(/\.ts$/, '');
			const expected: Record<string, string> = {
				'null3d-source': source,
				types: `${built}.d.ts`,
				default: `${built}.js`,
			};
			expect({ key, ...targets }).toEqual({ key, ...expected });
		}
	});

	it('reaches only the exact helpers, createMath and the error class, through any import', () => {
		const files = new Set(
			mathExports().flatMap(([, targets]) =>
				reachedFiles((targets['null3d-source'] as string).slice(2)),
			),
		);
		expect([...files].sort()).toEqual([
			'src/errors/engine-error-core.ts',
			'src/math/create-math.ts',
			'src/math/index.ts',
			'src/math/mat4.ts',
			'src/math/math.ts',
			'src/math/quat.ts',
			'src/math/vec3.ts',
		]);
		// The modules themselves name nothing that a simulation may not use, so no bundler, whether
		// it keeps whole modules or drops what is not called, can put such a name into one.
		for (const file of files) {
			const output = ts.transpileModule(readFileSync(join(ENGINE, file), 'utf8'), {
				compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
			}).outputText;
			const names = forbiddenNames(output).filter((name) => !name.startsWith('import of'));
			expect({ file, names }).toEqual({ file, names: [] });
		}
	});

	it(
		'gives a simulation that imports it a bundle with no name that a deterministic simulation may not use',
		async () => {
			const code = bundleSimulation();
			expect(forbiddenNames(code)).toEqual([]);
			// The fixture's bundle takes about 8.5 KB. Six helpers from the main entry bring about 8 KB
			// of engine code with them under Bun 1.4.3, which this cap would catch beside the scan.
			expect(code.length).toBeLessThan(12_000);

			// The bundle runs, and steps the ship as the fixture's own source does, bit for bit.
			const folder = mkdtempSync(join(tmpdir(), 'null3d-rules-code-'));
			try {
				const file = join(folder, 'sim.mjs');
				writeFileSync(file, code);
				type Simulation = typeof import('../../../../tests/fixtures/rules-code/sim.ts');
				const bundled = (await import(file)) as Simulation;
				const source = (await import(join(FIXTURE, 'sim.ts'))) as Simulation;
				// The browser's own `Math` stands in for the exact library that a game hands the simulation.
				const stepBundled = bundled.createSimulation(Math);
				const stepSource = source.createSimulation(Math);
				let last: number[] = [];
				for (let tick = 0; tick < 240; tick++) {
					const input = { turn: Math.sin(tick / 30), thrust: tick < 200 ? 1 : 0 };
					last = stepBundled(input);
					expect(last).toEqual(stepSource(input));
				}
				// A ship that never moved would pass the comparison above with any helper.
				expect(Math.hypot(last[0] as number, last[2] as number)).toBeGreaterThan(5);
				expect(last.every(Number.isFinite)).toBe(true);
			} finally {
				rmSync(folder, { recursive: true, force: true });
			}
		},
		scaledBudget(60_000),
	);
});

describe('the walk of the modules that a maths module reaches', () => {
	it('follows import(), require() and new URL() loads as well as declarations, and skips types alone', () => {
		const root = mkdtempSync(join(tmpdir(), 'null3d-reach-'));
		try {
			const files: Record<string, string> = {
				'math/entry.ts': [
					"import type { Shape } from './shape';",
					"export { add } from './add';",
					"export const later = () => import('../page/later');",
					"export const worker = () => new Worker(new URL('../page/worker.ts', import.meta.url));",
					"export const table = new URL('../page/table.bin', import.meta.url);",
					"export const site = new URL('/elsewhere', 'https://example.com/');",
				].join('\n'),
				'math/shape.ts': 'export interface Shape { size: number }',
				'math/add.ts':
					"export const add = (a: number, b: number) => a + b;\nrequire('../page/old');",
				'page/later.ts': 'export const page = document.title;',
				'page/old.ts': 'export const old = 1;',
				'page/worker.ts': 'postMessage(1);',
			};
			for (const [path, text] of Object.entries(files)) {
				mkdirSync(dirname(join(root, path)), { recursive: true });
				writeFileSync(join(root, path), text);
			}
			// A maths module that loads page code when called brings that code into its bundle.
			expect(reachedFiles('math/entry.ts', root)).toEqual([
				'math/add.ts',
				'math/entry.ts',
				'page/later.ts',
				'page/old.ts',
				'page/table.bin',
				'page/worker.ts',
			]);
			writeFileSync(
				join(root, 'math/entry.ts'),
				"const name = './add';\nexport const load = () => import(name);",
			);
			expect(() => reachedFiles('math/entry.ts', root)).toThrow(
				'loads a module that it names with no string',
			);
			writeFileSync(
				join(root, 'math/entry.ts'),
				"const name = './worker';\nexport const w = new URL(name, import.meta.url);",
			);
			expect(() => reachedFiles('math/entry.ts', root)).toThrow(
				'loads a module that it names with no string',
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('the scan of a simulation', () => {
	it("reads none of clockwork2's refused members of Math as exact", () => {
		expect(EXACT_MATH.filter((name) => BANNED_MATH.includes(name))).toEqual([]);
	});

	it('finds Math reached by a destructuring, an alias or a computed member', () => {
		expect(forbiddenNames('const { sin } = Math;\nexport const x = sin(1);')).toEqual(['Math']);
		expect(forbiddenNames('const M = Math;\nexport const y = M.exp(1);')).toEqual(['Math']);
		expect(forbiddenNames("export const z = Math['sin'](1);")).toEqual(['Math']);
		expect(forbiddenNames('export const w = Math.sin(1) + Math.sqrt(2);')).toEqual(['Math.sin']);
		expect(forbiddenNames('export const v = Math.sqrt(2) * Math.PI;')).toEqual([]);
	});

	it('finds a refused global that a name only an inner scope declares hides there alone', () => {
		const code = [
			'function local() {',
			'  const navigator = 1;',
			'  return navigator;',
			'}',
			'export const agent = [local(), navigator.userAgent];',
		].join('\n');
		expect(forbiddenNames(code)).toEqual(['navigator']);
		// A name that the module itself declares is not the global, wherever the module reads it.
		expect(forbiddenNames('const document = 1;\nexport const d = document + 1;')).toEqual([]);
		// A shorthand property reads the binding of its name.
		expect(forbiddenNames('export const o = { document };')).toEqual(['document']);
	});

	it('finds the global object, eval, powers, loads and locale calls', () => {
		expect(forbiddenNames('export const g = globalThis.Math.sin(1);')).toEqual(['globalThis']);
		expect(forbiddenNames("export const f = eval('1');")).toEqual(['eval']);
		expect(forbiddenNames('export const p = 2 ** 3;')).toEqual(['**']);
		expect(forbiddenNames("export const l = import('./x.js');")).toEqual(['import()']);
		expect(forbiddenNames('export const n = (1.5).toLocaleString();')).toEqual(['.toLocaleString']);
	});
});
