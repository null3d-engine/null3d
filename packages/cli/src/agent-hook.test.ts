import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	engineDeclarations,
	refusedCommand,
	refusedPatch,
	refusedSource,
} from '../templates/empty/.claude/agent-hook.mjs';

/** The hook script that the template installs. */
const HOOK = fileURLToPath(new URL('../templates/empty/.claude/agent-hook.mjs', import.meta.url));
/** The template's own files, which must follow the rules that the hook checks. */
const TEMPLATE = fileURLToPath(new URL('../templates/empty/', import.meta.url));

/** The folders that the tests made, removed after each test. */
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A folder of its own for one test. */
function tempRoot() {
	const root = mkdtempSync(join(tmpdir(), 'null3d-hook-'));
	roots.push(root);
	return root;
}

/** Runs the hook as Claude Code does, with one call on stdin. */
function runHook(event: string, call: unknown) {
	return spawnSync(process.execPath, [HOOK, event], {
		input: typeof call === 'string' ? call : JSON.stringify(call),
		encoding: 'utf8',
	});
}

describe('the command rules', () => {
	it('refuses waiting with sleep', () => {
		expect(refusedCommand('sleep 5')).toContain('do not wait with sleep');
		expect(refusedCommand('bun run test && sleep 1')).toContain('do not wait with sleep');
		expect(refusedCommand('timeout 30 sleep 1')).toContain('do not wait with sleep');
		expect(refusedCommand('timeout -s KILL 30 sleep 1')).toContain('do not wait with sleep');
		expect(refusedCommand('FOO=1 sleep 1')).toContain('do not wait with sleep');
		expect(refusedCommand('sudo -u root sleep 1')).toContain('do not wait with sleep');
		expect(refusedCommand('bun run test')).toBeNull();
		expect(refusedCommand('echo "sleep 5"')).toBeNull();
	});

	it('refuses stopping a process by name', () => {
		expect(refusedCommand('pkill -f vite')).toContain('do not stop a process by name');
		expect(refusedCommand('killall node')).toContain('do not stop a process by name');
		expect(refusedCommand('kill node')).toContain('do not stop a process by name');
		expect(refusedCommand('kill -9 $(pgrep vite)')).toContain('do not stop a process by name');
		expect(refusedCommand('kill 1234')).toBeNull();
		expect(refusedCommand('kill -9 1234 5678')).toBeNull();
	});

	it('refuses following a log, and allows reading it once', () => {
		expect(refusedCommand('tail -f dev.log')).toContain('do not follow a log');
		expect(refusedCommand('tail -F dev.log')).toContain('do not follow a log');
		expect(refusedCommand('tail -nf dev.log')).toContain('do not follow a log');
		expect(refusedCommand('journalctl -f')).toContain('do not follow a log');
		expect(refusedCommand('docker logs -f app')).toContain('do not follow a log');
		expect(refusedCommand('docker ps')).toBeNull();
		expect(refusedCommand('tail -n 200 dev.log')).toBeNull();
		expect(refusedCommand('cat dev.log')).toBeNull();
	});
});

describe('the source rules', () => {
	it('refuses an allocation in onUpdate', () => {
		const body = (line: string) =>
			`export default defineSketch(() => ({\n\tonUpdate(dt) {\n\t\t${line}\n\t},\n}));\n`;
		expect(refusedSource('src/sketch.ts', body('const v = new Float32Array(3);'))).toContain(
			'onUpdate',
		);
		expect(refusedSource('src/sketch.ts', body('const corners = [0, 1, 2];'))).toContain(
			'onUpdate',
		);
		expect(refusedSource('src/sketch.ts', body('const tmp = vec3.create();'))).toContain(
			'onUpdate',
		);
		expect(refusedSource('src/sketch.ts', body('mesh.setScale({ x: 2 });'))).toContain('onUpdate');
		expect(refusedSource('src/sketch.ts', body('const half = values.map(scale);'))).toContain(
			'onUpdate',
		);
		expect(refusedSource('src/sketch.ts', body('label.textContent = `t=$' + '{t}`;'))).toContain(
			'onUpdate',
		);
	});

	it('allows work that reuses objects made outside onUpdate', () => {
		const sketch = `const scratch = new Float32Array(3);\nexport default defineSketch(() => ({\n\tonUpdate(dt) {\n\t\tangle += dt;\n\t\tmesh.setPosition(scratch[0], scratch[1], scratch[2]);\n\t\t// new values come from the page\n\t},\n}));\n`;
		expect(refusedSource('src/sketch.ts', sketch)).toBeNull();
	});

	it('refuses DOM access in the sketch module alone', () => {
		const dom = 'const el = document.querySelector("canvas");\n';
		expect(refusedSource('src/sketch.ts', dom)).toContain('has no DOM');
		expect(refusedSource('src/scene/sketch.ts', 'window.location.reload();\n')).toContain(
			'has no DOM',
		);
		expect(refusedSource('src/page.ts', dom)).toBeNull();
		expect(refusedSource('src/sketch.ts', '// the sketch has no document\n')).toBeNull();
	});

	it('refuses an import that the installed engine does not export', () => {
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
		const declarations = engineDeclarations(root);

		expect(
			refusedSource(
				'src/page.ts',
				"import { createEngine, defineSketch } from '@null3d/engine';\n",
				{ declarations },
			),
		).toBeNull();
		expect(
			refusedSource(
				'src/page.ts',
				"import { createEngine, createWorld } from '@null3d/engine';\n",
				{ declarations },
			),
		).toContain('createWorld');
		expect(
			refusedSource('src/page.ts', "import { createWorld } from '@null3d/engine';\n", {
				declarations: '',
			}),
		).toBeNull();
	});

	it('lets the template pass its own rules', () => {
		const sketch = readFileSync(join(TEMPLATE, 'src/sketch.ts'), 'utf8');
		const page = readFileSync(join(TEMPLATE, 'src/page.ts'), 'utf8');
		expect(refusedSource('src/sketch.ts', sketch)).toBeNull();
		expect(refusedSource('src/page.ts', page)).toBeNull();
	});
});

describe('the Codex patch rules', () => {
	it('reads each file of a patch, and names the one that breaks a rule', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: src/page.ts',
			'@@',
			'-const canvas = null;',
			'+const canvas = document.querySelector("canvas");',
			'*** Update File: src/sketch.ts',
			'@@',
			'+const canvas = document.querySelector("canvas");',
			'*** End Patch',
		].join('\n');
		expect(refusedPatch(patch)).toContain('src/sketch.ts');
		expect(refusedPatch(patch)).toContain('has no DOM');
	});

	it('refuses an allocation that the patch adds to onUpdate', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: src/sketch.ts',
			'@@',
			'+return { onUpdate() { const view = new Float32Array(3); } };',
			'*** End Patch',
		].join('\n');
		expect(refusedPatch(patch)).toContain('creates an object');
	});

	it('allows a patch that breaks no rule', () => {
		const patch = [
			'*** Begin Patch',
			'*** Add File: src/helpers.ts',
			'+export const twice = (value) => value * 2;',
			'*** End Patch',
		].join('\n');
		expect(refusedPatch(patch)).toBeNull();
	});
});

describe('the hook entry', () => {
	it('refuses a command with exit code 2 and the reason', () => {
		const result = runHook('bash', {
			tool_name: 'Bash',
			tool_input: { command: 'sleep 10' },
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toContain('do not wait with sleep');
	});

	it('allows a command that breaks no rule', () => {
		const result = runHook('bash', {
			tool_name: 'Bash',
			tool_input: { command: 'bun run test' },
		});
		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
	});

	it('refuses an edit that touches the DOM in the sketch', () => {
		const result = runHook('edit', {
			tool_name: 'Write',
			tool_input: {
				file_path: 'src/sketch.ts',
				content: 'const el = document.querySelector("canvas");\n',
			},
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toContain('has no DOM');
	});

	it('allows the same edit in the page module', () => {
		const result = runHook('edit', {
			tool_name: 'Write',
			tool_input: {
				file_path: 'src/page.ts',
				content: 'const el = document.querySelector("canvas");\n',
			},
		});
		expect(result.status).toBe(0);
	});

	it('allows a call that it cannot read, so its own fault stops no work', () => {
		expect(runHook('bash', 'not json').status).toBe(0);
	});

	it('refuses a DOM edit that Codex sends as a patch', () => {
		const result = runHook('', {
			session_id: 'session',
			turn_id: 'turn',
			hook_event_name: 'PreToolUse',
			tool_name: 'apply_patch',
			tool_input: {
				command: [
					'*** Begin Patch',
					'*** Update File: src/sketch.ts',
					'@@',
					'+const canvas = document.querySelector("canvas");',
					'*** End Patch',
				].join('\n'),
			},
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toContain('has no DOM');
	});
});
