// The maths entry, `@null3d/engine/math` and its sub-paths, holds only code that a deterministic
// simulation may run: exact arithmetic, and the helpers that createMath builds on functions that the
// caller gives. These checks bundle a simulation that imports it, as a game's build bundles its
// simulation, and read the bundle for every name that such a simulation may not use. They also hold
// the entry's modules to importing nothing outside the maths folder, so a bundler that keeps a whole
// module still reaches no page, worker, generated or WebAssembly code, and the package's exports map
// to naming each module's built twin.
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { MathFunctions } from './create-math';

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
 * Names that clockwork2's list leaves out, because a simulation could not reach them anyway, and that
 * mark the engine's page and worker code: a worker, shared memory and the thread's global object.
 */
const PAGE_AND_WORKER = [
	'Worker',
	'SharedArrayBuffer',
	'importScripts',
	'postMessage',
	'addEventListener',
	'globalThis',
	'self',
	'location',
];

/** The browser's own functions, which the checks hand the simulation, as a game hands it dmath's. */
const BROWSER: MathFunctions = { sin: Math.sin, cos: Math.cos, acos: Math.acos, exp: Math.exp };

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

/** The names in `code` that a deterministic simulation may not use, each once, in order of use. */
function forbiddenNames(code: string): string[] {
	const file = ts.createSourceFile('sim.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	// A name that the bundle declares itself is not the global of that name.
	const declared = new Set<string>();
	const declare = (node: ts.Node): void => {
		if (
			(ts.isVariableDeclaration(node) ||
				ts.isFunctionDeclaration(node) ||
				ts.isClassDeclaration(node) ||
				ts.isParameter(node)) &&
			node.name &&
			ts.isIdentifier(node.name)
		)
			declared.add(node.name.text);
		ts.forEachChild(node, declare);
	};
	declare(file);
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
		} else if (ts.isPropertyAccessExpression(node)) {
			const name = node.name.text;
			if (
				ts.isIdentifier(node.expression) &&
				node.expression.text === 'Math' &&
				BANNED_MATH.includes(name)
			)
				found.add(`Math.${name}`);
			if (BANNED_PROPERTIES.includes(name)) found.add(`.${name}`);
		} else if (ts.isElementAccessExpression(node)) {
			const key = node.argumentExpression;
			if (
				ts.isIdentifier(node.expression) &&
				node.expression.text === 'Math' &&
				ts.isStringLiteralLike(key) &&
				BANNED_MATH.includes(key.text)
			)
				found.add(`Math.${key.text}`);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			found.add('import()');
		} else if (ts.isMetaProperty(node)) {
			found.add('import.meta');
		} else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			if (node.moduleSpecifier) found.add(`import of ${node.moduleSpecifier.getText(file)}`);
		} else if (ts.isIdentifier(node) && globals.has(node.text) && !declared.has(node.text)) {
			const parent = node.parent;
			const isMemberName =
				(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
				((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
					parent.name === node);
			if (!isMemberName) found.add(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return [...found];
}

/** The engine's source files that `entry` reaches through its imports, as paths from the engine. */
function reachedFiles(entry: string): string[] {
	const reached = new Set<string>();
	const walk = (file: string): void => {
		const path = relative(ENGINE, file);
		if (reached.has(path)) return;
		reached.add(path);
		const text = readFileSync(file, 'utf8');
		for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
			if (!fileName.startsWith('.'))
				throw new Error(`${path} imports ${fileName}, which is not one of the engine's own files`);
			const target = resolve(dirname(file), fileName);
			walk(target.endsWith('.ts') ? target : `${target}.ts`);
		}
	};
	walk(join(ENGINE, entry));
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

	it('reaches only the exact helpers, createMath and the array types, through any import', () => {
		const files = new Set(
			mathExports().flatMap(([, targets]) =>
				reachedFiles((targets['null3d-source'] as string).slice(2)),
			),
		);
		expect([...files].sort()).toEqual([
			'src/math/create-math.ts',
			'src/math/index.ts',
			'src/math/mat4.ts',
			'src/math/math.ts',
			'src/math/quat.ts',
			'src/math/types.ts',
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
			// The simulation's helpers take about 8 KB. The main entry adds 8 KB more under Bun 1.4.3,
			// and 87 KB under Bun 1.3.11, of page code that no simulation may hold.
			expect(code.length).toBeLessThan(12_000);

			// The bundle runs, and steps the ship as the fixture's own source does, bit for bit.
			const folder = mkdtempSync(join(tmpdir(), 'null3d-rules-code-'));
			try {
				const file = join(folder, 'sim.mjs');
				writeFileSync(file, code);
				type Simulation = typeof import('../../../../tests/fixtures/rules-code/sim.ts');
				const bundled = (await import(file)) as Simulation;
				const source = (await import(join(FIXTURE, 'sim.ts'))) as Simulation;
				const stepBundled = bundled.createSimulation(BROWSER);
				const stepSource = source.createSimulation(BROWSER);
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
