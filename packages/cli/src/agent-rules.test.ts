import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	engineDeclarations,
	RULES,
	refusedCommand,
	refusedSource,
	ruleFor,
} from './agent-rules.js';

/** The template's own files, which must follow every rule that the hook checks. */
const TEMPLATE = fileURLToPath(new URL('../templates/empty/', import.meta.url));

/** The folders that the tests made, removed after each test. */
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A folder of its own for one test. */
function tempRoot() {
	const root = mkdtempSync(join(tmpdir(), 'null3d-rules-'));
	roots.push(root);
	return root;
}

/** The id of the rule that refuses `command`, or null when it refuses none. */
function commandRule(command: string) {
	return refusedCommand(command)?.id ?? null;
}

/**
 * The id of the rule that an edit of `file` breaks, or null when it breaks none.
 *
 * @param {string} file
 * @param {string} source
 * @param {string} [declarations]
 */
function sourceRule(file: string, source: string, declarations = '') {
	return refusedSource(file, source, { declarations })?.id ?? null;
}

describe('the rule list', () => {
	it('names every rule once', () => {
		const ids = RULES.map((rule) => rule.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual([
			'no-sleep',
			'no-kill-by-name',
			'no-log-follow',
			'no-planned-api',
			'no-allocation-in-onupdate',
			'no-dom-in-sketch',
		]);
	});

	it('refuses a command rule and flags a source rule', () => {
		for (const rule of RULES) {
			expect(rule.action).toBe(rule.kind === 'command' ? 'refuse' : 'flag');
			expect(ruleFor(rule.id)).toBe(rule);
		}
		expect(ruleFor('no-such-rule')).toBeUndefined();
	});

	it('lists the same rules in the template AGENTS.md', () => {
		const agents = readFileSync(join(TEMPLATE, 'AGENTS.md'), 'utf8');
		for (const rule of RULES) {
			expect(agents).toContain(`\`${rule.id}\` | ${rule.action} |`);
		}
	});
});

describe('no-sleep', () => {
	it('refuses waiting with sleep', () => {
		for (const command of [
			'sleep 5',
			'bun run test && sleep 1',
			'timeout 30 sleep 1',
			'timeout -s KILL 30 sleep 1',
			'FOO=1 sleep 1',
			'sudo -u root sleep 1',
			'env -i sleep 1',
			'sleep 1 &',
		]) {
			expect(commandRule(command)).toBe('no-sleep');
		}
		expect(refusedCommand('sleep 5')?.message).toContain('do not wait with sleep');
	});

	it('allows a command that does not wait', () => {
		expect(commandRule('bun run test')).toBeNull();
		expect(commandRule('echo "sleep 5"')).toBeNull();
		expect(commandRule('bunx @null3d/cli test')).toBeNull();
	});
});

describe('no-kill-by-name', () => {
	it('refuses stopping a process by name', () => {
		for (const command of [
			'pkill -f vite',
			'killall node',
			'kill node',
			'kill -9 $(pgrep vite)',
			'kill',
			'kill %1',
		]) {
			expect(commandRule(command)).toBe('no-kill-by-name');
		}
		expect(refusedCommand('pkill -f vite')?.message).toContain('by its PID');
	});

	it('allows stopping a process by its PID', () => {
		expect(commandRule('kill 1234')).toBeNull();
		expect(commandRule('kill -9 1234 5678')).toBeNull();
		expect(commandRule('kill -TERM 1234')).toBeNull();
		expect(commandRule('echo kill')).toBeNull();
	});
});

describe('no-log-follow', () => {
	it('refuses following a log', () => {
		for (const command of [
			'tail -f dev.log',
			'tail -F dev.log',
			'tail -nf dev.log',
			'tail --follow=name dev.log',
			'journalctl -f',
			'docker logs -f app',
			'kubectl logs -f pod',
			'less +F dev.log',
		]) {
			expect(commandRule(command)).toBe('no-log-follow');
		}
		expect(refusedCommand('tail -f dev.log')?.message).toContain('do not follow a log');
	});

	it('allows reading a log once', () => {
		expect(commandRule('tail -n 200 dev.log')).toBeNull();
		expect(commandRule('docker ps')).toBeNull();
		expect(commandRule('cat dev.log')).toBeNull();
	});
});

describe('no-planned-api', () => {
	/** A folder that holds an installed engine with one exported name. */
	function engineRoot() {
		const root = tempRoot();
		const engine = join(root, 'node_modules', '@null3d', 'engine');
		mkdirSync(join(engine, 'lib'), { recursive: true });
		writeFileSync(
			join(engine, 'package.json'),
			JSON.stringify({ name: '@null3d/engine', exports: { '.': { types: './lib/index.d.ts' } } }),
		);
		writeFileSync(
			join(engine, 'lib', 'index.d.ts'),
			'export declare function createEngine(): void;\nexport declare function defineSketch(): void;\n',
		);
		return engineDeclarations(root);
	}

	it('flags an import that the installed engine does not export', () => {
		const declarations = engineRoot();
		const planned =
			"import { createEngine, createWorld } from '@null3d/engine';\nawait createEngine();\n";
		expect(sourceRule('src/page.ts', planned, declarations)).toBe('no-planned-api');
		expect(refusedSource('src/page.ts', planned, { declarations })?.message).toContain(
			'createWorld',
		);
	});

	it('allows an import that the engine exports', () => {
		const declarations = engineRoot();
		expect(
			sourceRule("import { createEngine, defineSketch } from '@null3d/engine';\n", declarations),
		).toBeNull();
		expect(
			sourceRule("import type { createEngine } from '@null3d/engine';\n", declarations),
		).toBeNull();
	});

	it('checks nothing when the project has no engine installed', () => {
		expect(engineDeclarations(tempRoot())).toBe('');
		expect(sourceRule('src/page.ts', "import { createWorld } from '@null3d/engine';\n")).toBeNull();
	});
});

describe('no-allocation-in-onupdate', () => {
	it('flags an object, array or string made in the frame update', () => {
		const body = (line: string) =>
			`export default defineSketch(() => ({\n\tonUpdate(dt) {\n\t\t${line}\n\t},\n}));\n`;
		for (const line of [
			'const v = new Float32Array(3);',
			'const corners = [0, 1, 2];',
			'mesh.setScale({ x: 2 });',
			'const half = values.map(scale);',
			'label.textContent = `t=$' + '{t}`;',
			'return { angle };',
		]) {
			expect(sourceRule('src/sketch.ts', body(line))).toBe('no-allocation-in-onupdate');
		}
	});

	it('reads the arrow form of the frame update too', () => {
		const sketch =
			'const sketch = {\n\tonUpdate: (dt) => {\n\t\tconst v = new Float32Array(3);\n\t},\n};\n';
		expect(sourceRule('src/sketch.ts', sketch)).toBe('no-allocation-in-onupdate');
	});

	it('allows work that reuses objects made outside the frame update', () => {
		const sketch = `const scratch = new Float32Array(3);\nexport default defineSketch(() => ({\n\tonUpdate(dt) {\n\t\tangle += dt;\n\t\tcube.setPosition(scratch[0] ?? 0, 0, 0);\n\t\t// new values come from the page\n\t},\n}));\n`;
		expect(sourceRule('src/sketch.ts', sketch)).toBeNull();
	});

	it('ignores brackets and words inside a string', () => {
		const sketch = `export default defineSketch(() => ({\n\tonUpdate(dt) {\n\t\tlabel.textContent = "a { b [ c document";\n\t},\n}));\n`;
		expect(sourceRule('src/page.ts', sketch)).toBeNull();
	});
});

describe('no-dom-in-sketch', () => {
	it('flags DOM access in the sketch module', () => {
		expect(sourceRule('src/sketch.ts', 'const el = document.querySelector("canvas");\n')).toBe(
			'no-dom-in-sketch',
		);
		expect(sourceRule('src/scene/sketch.ts', 'window.location.reload();\n')).toBe(
			'no-dom-in-sketch',
		);
		expect(sourceRule('src/sketch.ts', 'requestAnimationFrame(draw);\n')).toBe('no-dom-in-sketch');
	});

	it('allows DOM access in the page module', () => {
		expect(sourceRule('src/page.ts', 'const el = document.querySelector("canvas");\n')).toBeNull();
	});

	it('ignores a DOM name in a comment or a string', () => {
		expect(sourceRule('src/sketch.ts', '// the sketch has no document\n')).toBeNull();
		expect(sourceRule('src/sketch.ts', 'const note = "window";\n')).toBeNull();
	});
});

describe('the template', () => {
	it('passes every rule with the engine missing', () => {
		const sketch = readFileSync(join(TEMPLATE, 'src/sketch.ts'), 'utf8');
		const page = readFileSync(join(TEMPLATE, 'src/page.ts'), 'utf8');
		expect(sourceRule('src/sketch.ts', sketch)).toBeNull();
		expect(sourceRule('src/page.ts', page)).toBeNull();
	});
});
