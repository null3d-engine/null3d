import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The hook that the template installs, and that Claude Code and Codex both run. */
const HOOK = fileURLToPath(new URL('../templates/empty/.agent/agent-hook.mjs', import.meta.url));

/** The sketch that each edit test starts from. */
const SKETCH = [
	"import { defineSketch } from '@null3d/engine';",
	'',
	'export default defineSketch(() => ({',
	'\tonUpdate(dt) {',
	'\t\tangle += dt;',
	'\t},',
	'}));',
	'',
].join('\n');

/** The folders that the tests made, removed after each test. */
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project folder with one sketch file. */
function project() {
	const root = mkdtempSync(join(tmpdir(), 'null3d-hook-'));
	roots.push(root);
	mkdirSync(join(root, 'src'), { recursive: true });
	writeFileSync(join(root, 'src', 'sketch.ts'), SKETCH);
	return root;
}

/** Runs the hook as an agent does, with one call on stdin. */
function runHook(mode: string, call: unknown, root?: string) {
	return spawnSync(process.execPath, [HOOK, mode], {
		input: typeof call === 'string' ? call : JSON.stringify(call),
		encoding: 'utf8',
		cwd: root,
	});
}

/** The context that the hook gives the agent for a call it flags. */
function flagged(result: ReturnType<typeof runHook>) {
	const output = result.stdout.trim();
	if (output === '') return '';
	return JSON.parse(output).hookSpecificOutput.additionalContext;
}

describe('the command rules', () => {
	it('refuses a command that waits with sleep', () => {
		const result = runHook('bash', {
			tool_name: 'Bash',
			tool_input: { command: 'sleep 10' },
		});
		expect(result.status).toBe(2);
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain('do not wait with sleep');
	});

	it('refuses a command that stops a process by name', () => {
		const result = runHook('bash', { tool_name: 'Bash', tool_input: { command: 'pkill vite' } });
		expect(result.status).toBe(2);
		expect(result.stderr).toContain('by its PID');
	});

	it('refuses a command that follows a log', () => {
		const result = runHook('bash', { tool_name: 'Bash', tool_input: { command: 'tail -f log' } });
		expect(result.status).toBe(2);
		expect(result.stderr).toContain('do not follow a log');
	});

	it('allows a command that breaks no rule', () => {
		const result = runHook('bash', { tool_name: 'Bash', tool_input: { command: 'bun run test' } });
		expect(result.status).toBe(0);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('');
	});
});

describe('the source rules', () => {
	it('flags an allocation in onUpdate and lets the edit go on', () => {
		const root = project();
		const result = runHook(
			'edit',
			{
				tool_name: 'Edit',
				tool_input: {
					file_path: 'src/sketch.ts',
					old_string: '\t\tangle += dt;',
					new_string: '\t\tangle += dt;\n\t\tconst v = new Float32Array(3);',
				},
			},
			root,
		);
		expect(result.status).toBe(0);
		expect(flagged(result)).toContain('onUpdate');
	});

	it('flags a write that reaches the DOM from the sketch', () => {
		const result = runHook('edit', {
			tool_name: 'Write',
			tool_input: {
				file_path: 'src/sketch.ts',
				content: 'const el = document.querySelector("canvas");\n',
			},
		});
		expect(result.status).toBe(0);
		expect(flagged(result)).toContain('has no DOM');
	});

	it('allows the same write in the page module', () => {
		const result = runHook('edit', {
			tool_name: 'Write',
			tool_input: {
				file_path: 'src/page.ts',
				content: 'const el = document.querySelector("canvas");\n',
			},
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toBe('');
	});

	it('reads the edits of a MultiEdit call', () => {
		const root = project();
		const result = runHook(
			'edit',
			{
				tool_name: 'MultiEdit',
				tool_input: {
					file_path: 'src/sketch.ts',
					edits: [{ old_string: '\t\tangle += dt;', new_string: '\t\tangle += dt * 2;' }],
				},
			},
			root,
		);
		expect(result.status).toBe(0);
		expect(result.stdout).toBe('');
	});

	it('flags a planned API that the installed engine does not export', () => {
		const root = project();
		const engine = join(root, 'node_modules', '@null3d', 'engine');
		mkdirSync(join(engine, 'lib'), { recursive: true });
		writeFileSync(
			join(engine, 'package.json'),
			JSON.stringify({ exports: { '.': { types: './lib/index.d.ts' } } }),
		);
		writeFileSync(
			join(engine, 'lib', 'index.d.ts'),
			'export declare function createEngine(): void;\n',
		);
		const result = runHook(
			'edit',
			{
				tool_name: 'Write',
				tool_input: {
					file_path: 'src/page.ts',
					content: "import { createWorld } from '@null3d/engine';\n",
				},
			},
			root,
		);
		expect(result.status).toBe(0);
		expect(flagged(result)).toContain('createWorld');
	});
});

describe('the Codex patch', () => {
	it('reads the file that an update patch leaves behind', () => {
		const root = project();
		const patch = [
			'*** Begin Patch',
			'*** Update File: src/sketch.ts',
			'@@',
			' \tonUpdate(dt) {',
			'+\t\tconst v = new Float32Array(3);',
			' \t\tangle += dt;',
			' \t},',
			'*** End Patch',
		].join('\n');
		const result = runHook(
			'edit',
			{ tool_name: 'apply_patch', tool_input: { command: patch } },
			root,
		);
		expect(result.status).toBe(0);
		expect(flagged(result)).toContain('onUpdate');
	});

	it('reads a file that the patch adds', () => {
		const result = runHook('edit', {
			tool_name: 'apply_patch',
			tool_input: {
				command: [
					'*** Begin Patch',
					'*** Add File: src/scene/sketch.ts',
					'+const el = document.querySelector("canvas");',
					'*** End Patch',
				].join('\n'),
			},
		});
		expect(result.status).toBe(0);
		expect(flagged(result)).toContain('has no DOM');
	});

	it('reads the lines around an addition when the patch does not fit the file', () => {
		const root = project();
		const patch = [
			'*** Begin Patch',
			'*** Update File: src/sketch.ts',
			'@@',
			' \tonUpdate(dt) {',
			'+\t\tconst v = new Float32Array(3);',
			' \t\tangle += dt * 3;',
			'*** End Patch',
		].join('\n');
		const result = runHook(
			'edit',
			{ tool_name: 'apply_patch', tool_input: { command: patch } },
			root,
		);
		expect(result.status).toBe(0);
		expect(flagged(result)).toContain('onUpdate');
	});

	it('allows a patch that breaks no rule', () => {
		const root = project();
		const patch = [
			'*** Begin Patch',
			'*** Update File: src/sketch.ts',
			'@@',
			' \t\tangle += dt;',
			'+\t\tangle += 0;',
			'*** End Patch',
		].join('\n');
		const result = runHook(
			'edit',
			{ tool_name: 'apply_patch', tool_input: { command: patch } },
			root,
		);
		expect(result.status).toBe(0);
		expect(result.stdout).toBe('');
	});
});

describe('the hook itself', () => {
	it('allows a call that it cannot read, so its own fault stops no work', () => {
		expect(runHook('bash', 'not json').status).toBe(0);
		expect(runHook('edit', { tool_name: 'Write', tool_input: {} }).status).toBe(0);
	});

	it('takes every rule from the shared module', () => {
		const hook = readFileSync(HOOK, 'utf8');
		expect(hook).toContain("'@null3d/cli/agent-rules'");
		expect(hook).not.toContain('do not wait with sleep');
	});

	it('allows each call before the project has installed its packages', () => {
		const root = mkdtempSync(join(tmpdir(), 'null3d-hook-'));
		roots.push(root);
		const copy = join(root, '.agent');
		mkdirSync(copy, { recursive: true });
		const hook = join(copy, 'agent-hook.mjs');
		writeFileSync(hook, readFileSync(HOOK, 'utf8'));
		const empty = join(root, 'empty');
		mkdirSync(empty);

		const result = spawnSync(process.execPath, [hook, 'bash'], {
			input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sleep 5' } }),
			encoding: 'utf8',
			cwd: empty,
		});
		expect(result.status).toBe(0);
		expect(result.stderr).toContain('Run bun install');
	});
});
