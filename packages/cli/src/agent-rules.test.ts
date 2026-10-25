import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	engineDeclarations,
	MESSAGE_PHRASES,
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

/** The frame update that each allocation test wraps one line in. */
function body(line: string) {
	return `export default defineSketch(() => ({\n\tonUpdate(dt) {\n\t\t${line}\n\t},\n}));\n`;
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

	it('gives every rule one fixed message', () => {
		expect(MESSAGE_PHRASES).toHaveLength(RULES.length);
		expect(new Set(MESSAGE_PHRASES).size).toBe(MESSAGE_PHRASES.length);
	});
});

describe('no-sleep', () => {
	it('refuses waiting with sleep, whatever form the command takes', () => {
		for (const command of [
			'sleep 5',
			'bun run test && sleep 1',
			'timeout 30 sleep 1',
			'timeout -s KILL 30 sleep 1',
			'FOO=1 sleep 1',
			'sudo -u root sleep 1',
			'env -i sleep 1',
			'nice -n 5 sleep 1',
			'sleep 1 &',
			'/bin/sleep 1',
			'bash -c "sleep 1"',
			"sh -lc 'sleep 2'",
			'bun run build | tee build.log; sleep 3',
			'sleep 1 2>/dev/null',
			'bash <<EOF\nsleep 5\nEOF',
			"sh -s <<'EOF'\nsleep 5\nEOF",
		]) {
			expect(commandRule(command)).toBe('no-sleep');
		}
		expect(refusedCommand('sleep 5')?.message).toContain('do not wait with sleep');
	});

	it('allows a command that does not wait, or only talks about waiting', () => {
		for (const command of [
			'bun run test',
			'echo "sleep 5"',
			'bunx @null3d/cli test',
			'git commit -m "sleep 1 before the fix"',
			'echo "a | b"',
			'bun run build # sleep 1',
			"cat > note.txt <<'EOF'\nsleep 1 in prose\nEOF",
			'bash <<EOF\necho hello\nEOF',
			'bash -c "echo hello"',
			'grep -n sleep dev.log',
		]) {
			expect(commandRule(command)).toBeNull();
		}
	});
});

describe('no-kill-by-name', () => {
	it('refuses stopping a process by name', () => {
		for (const command of [
			'pkill -f vite',
			'killall node',
			'kill node',
			'kill -9 node',
			'kill -s TERM vite',
			'kill',
			'kill -9 $(pgrep vite)',
			'kill $(pidof vite)',
			'kill -- -1234',
			'pkill -P 1234',
			'pgrep vite | xargs kill',
			'pidof vite | xargs kill',
			'ps aux | grep vite | xargs kill',
			'bash -c "killall node"',
		]) {
			expect(commandRule(command)).toBe('no-kill-by-name');
		}
		expect(refusedCommand('pkill -f vite')?.message).toContain('by its PID');
	});

	it('allows stopping a process that the command names by its number', () => {
		for (const command of [
			'kill 1234',
			'kill -9 1234 5678',
			'kill -TERM 1234',
			'kill -s TERM 1234',
			'kill -n 15 1234',
			'kill -s KILL 1234',
			'kill $!',
			'kill "$PID"',
			'kill $' + '{PID}',
			'kill $(cat run/server.pid)',
			'kill $(cat run/server.pid) 2>/dev/null',
			'kill %1',
			'kill -0 $$',
			'kill -l',
			'kill $(ps -o pid= -p $$)',
			'kill $' + '{PIDS[@]}',
			'kill $' + '{PID:-0}',
			'kill -- 1234',
			'cat .vite.pid | xargs kill',
			'lsof -ti:5173 | xargs kill',
			'xargs kill < pids.txt',
			'xargs kill 1234 < pids.txt',
			'command -v kill',
		]) {
			expect(commandRule(command)).toBeNull();
		}
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
			'bash -c "tail -f dev.log"',
		]) {
			expect(commandRule(command)).toBe('no-log-follow');
		}
		expect(refusedCommand('tail -f dev.log')?.message).toContain('do not follow a log');
	});

	it('allows reading a log once', () => {
		expect(commandRule('tail -n 200 dev.log')).toBeNull();
		expect(commandRule('docker ps')).toBeNull();
		expect(commandRule('cat dev.log')).toBeNull();
		expect(commandRule('dev-server | tail -n 50')).toBeNull();
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

	it('reads each form that a frame update takes', () => {
		expect(
			sourceRule(
				'src/sketch.ts',
				'const sketch = {\n\tonUpdate: (dt) => {\n\t\tconst v = new Float32Array(3);\n\t},\n};\n',
			),
		).toBe('no-allocation-in-onupdate');
		expect(
			sourceRule(
				'src/sketch.ts',
				'const sketch = {\n\tonUpdate: function (dt) {\n\t\tconst v = new Float32Array(3);\n\t},\n};\n',
			),
		).toBe('no-allocation-in-onupdate');
	});

	it('follows a frame update that names a closure made above it', () => {
		expect(
			sourceRule(
				'src/sketch.ts',
				'const update = (dt) => {\n\tconst v = new Float32Array(3);\n};\nexport default { onUpdate: update };\n',
			),
		).toBe('no-allocation-in-onupdate');
		expect(
			sourceRule(
				'src/sketch.ts',
				'function update(dt) {\n\tconst v = new Float32Array(3);\n}\nexport default { onUpdate: update };\n',
			),
		).toBe('no-allocation-in-onupdate');
		expect(
			sourceRule(
				'src/sketch.ts',
				'const onUpdate = () => {\n\tconst v = new Float32Array(3);\n};\nexport default { onUpdate };\n',
			),
		).toBe('no-allocation-in-onupdate');
	});

	it('allows work that reuses objects made outside the frame update', () => {
		const sketch = `const scratch = new Float32Array(3);\nexport default defineSketch(() => ({\n\tonUpdate(dt) {\n\t\tangle += dt;\n\t\tcube.setPosition(scratch[0] ?? 0, 0, 0);\n\t\t// new values come from the page\n\t},\n}));\n`;
		expect(sourceRule('src/sketch.ts', sketch)).toBeNull();
	});

	it('reads a URL in a string as text, not as the start of a comment', () => {
		expect(
			sourceRule(
				'src/sketch.ts',
				body('label.textContent = "https://example.com"; const v = new Float32Array(3);'),
			),
		).toBe('no-allocation-in-onupdate');
		expect(
			sourceRule('src/sketch.ts', body('label.textContent = "https://example.com/a//b";')),
		).toBeNull();
	});

	it('ignores brackets and words inside a string', () => {
		expect(sourceRule('src/page.ts', body('label.textContent = "a { b [ c document";'))).toBeNull();
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
		expect(sourceRule('src/sketch.ts', '/* window and document */\n')).toBeNull();
	});
});

describe('the template', () => {
	it('passes every rule with the engine missing', () => {
		const sketch = readFileSync(join(TEMPLATE, 'src/sketch.ts'), 'utf8');
		const page = readFileSync(join(TEMPLATE, 'src/page.ts'), 'utf8');
		expect(sourceRule('src/sketch.ts', sketch)).toBeNull();
		expect(sourceRule('src/page.ts', page)).toBeNull();
	});

	it('passes its own AGENTS.md rules as a command', () => {
		expect(commandRule('bunx @null3d/cli test')).toBeNull();
	});
});
