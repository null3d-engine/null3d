import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from './args.js';
import { createProject, packageNameFor, parseCreateArgs, templateNames } from './create.js';

/** The folders that the tests made, removed after each test. */
const roots: string[] = [];

/** A folder of its own for one test. */
function tempRoot() {
	const root = mkdtempSync(join(tmpdir(), 'null3d-create-'));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The tools that an agent settings file runs the hook before. */
function hookMatchers(settings: { hooks: { PreToolUse: { matcher: string }[] } }) {
	return settings.hooks.PreToolUse.map((hook) => hook.matcher);
}

/** What parsing `args` throws, as the message a person sees. */
function mistake(args: string[]): string {
	try {
		parseCreateArgs(args);
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error(`${args.join(' ')} parsed without a mistake`);
}

describe('parseCreateArgs', () => {
	it('reads the folder and the default template', () => {
		expect(parseCreateArgs(['my-game'])).toEqual({
			dir: 'my-game',
			template: 'empty',
			help: false,
		});
	});

	it('reads another template and the help', () => {
		expect(parseCreateArgs(['my-game', '--template', 'empty']).template).toBe('empty');
		expect(parseCreateArgs(['--help']).help).toBe(true);
	});

	it('needs one folder', () => {
		expect(mistake([])).toBe('it needs the folder to make the project in');
		expect(mistake(['one', 'two'])).toBe('it takes one folder, not 2');
		expect(mistake(['my-game', '--template'])).toContain('--template needs a value');
	});
});

describe('createProject', () => {
	it('writes the template with the version and the project name', () => {
		const root = tempRoot();
		const target = createProject({ dir: join(root, 'my-game'), version: '0.1.0' });

		// Every file the project holds, relative to its folder, in one sorted list.
		const listed = (root: string): string[] =>
			readdirSync(root, { recursive: true, withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => relative(root, join(entry.parentPath, entry.name)))
				.sort();

		// The template holds exactly these files. The list is written out rather than read from the
		// template folder, so a file left in the folder shows up as a project file that no line here
		// names.
		expect(listed(target)).toEqual([
			'.agent/agent-hook.mjs',
			'.claude/settings.json',
			'.codex/hooks.json',
			'.gitignore',
			'AGENTS.md',
			'index.html',
			'package.json',
			'src/page.ts',
			'src/sketch.ts',
			'tsconfig.json',
			'vite.config.ts',
		]);

		const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
		expect(manifest.name).toBe('my-game');
		expect(manifest.private).toBe(true);
		expect(manifest.dependencies['@null3d/engine']).toBe('0.1.0');
		expect(manifest.devDependencies['@null3d/vite-plugin']).toBe('0.1.0');
		expect(manifest.devDependencies['@null3d/cli']).toBe('0.1.0');
	});

	it('names the installed version and the skill in the agent rules', () => {
		const root = tempRoot();
		const target = createProject({ dir: join(root, 'my-game'), version: '0.2.0' });
		const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8');

		expect(agents).toContain('null3D 0.2.0');
		expect(agents).toContain('null3d-develop');
		expect(agents).toContain('status is `planned`');
		expect(agents).not.toContain('{{');
	});

	it('writes no unfilled text in any template file', () => {
		const root = tempRoot();
		const target = createProject({ dir: join(root, 'my-game'), version: '0.1.0' });
		for (const file of ['package.json', 'AGENTS.md', 'index.html', 'src/page.ts']) {
			expect(readFileSync(join(target, file), 'utf8')).not.toContain('{{');
		}
	});

	it('turns the hook on for commands and for edits, in both agents', () => {
		const root = tempRoot();
		const target = createProject({ dir: join(root, 'my-game'), version: '0.1.0' });
		const claude = JSON.parse(readFileSync(join(target, '.claude/settings.json'), 'utf8'));
		const codex = JSON.parse(readFileSync(join(target, '.codex/hooks.json'), 'utf8'));

		expect(hookMatchers(claude)).toEqual(['Bash', 'Edit|Write|MultiEdit']);
		expect(hookMatchers(codex)).toEqual(['Bash', 'Edit|Write|apply_patch']);
		for (const settings of [claude, codex]) {
			expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('.agent/agent-hook.mjs');
			expect(settings.hooks.PreToolUse[1].hooks[0].command).toContain('.agent/agent-hook.mjs');
		}
	});

	it('runs every hook that a new project installs', () => {
		const root = tempRoot();
		const target = createProject({ dir: join(root, 'my-game'), version: '0.1.0' });
		const link = join(target, 'node_modules', '@null3d', 'cli');
		mkdirSync(join(target, 'node_modules', '@null3d'), { recursive: true });
		symlinkSync(fileURLToPath(new URL('..', import.meta.url)), link, 'dir');

		const claude = JSON.parse(readFileSync(join(target, '.claude/settings.json'), 'utf8'));
		const codex = JSON.parse(readFileSync(join(target, '.codex/hooks.json'), 'utf8'));
		const commands = (settings: { hooks: { PreToolUse: { hooks: { command: string }[] }[] } }) =>
			settings.hooks.PreToolUse.map((hook) => hook.hooks[0]?.command ?? '');
		const [claudeBash = '', claudeEdit = ''] = commands(claude);
		const [codexBash = '', codexEdit = ''] = commands(codex);

		/** Runs a command's hook the way Claude Code does. */
		const runClaude = (command: string, call: object) =>
			spawnSync('sh', ['-c', command], {
				cwd: target,
				input: JSON.stringify(call),
				encoding: 'utf8',
				env: { ...process.env, CLAUDE_PROJECT_DIR: target },
			});
		const withoutProjectDir = { ...process.env };
		delete withoutProjectDir.CLAUDE_PROJECT_DIR;
		/** Runs a command's hook the way Codex does, from the project's source folder. */
		const runCodex = (command: string, call: object) =>
			spawnSync('sh', ['-c', command], {
				cwd: join(target, 'src'),
				input: JSON.stringify({ cwd: target, ...call }),
				encoding: 'utf8',
				env: withoutProjectDir,
			});

		const domInSketch = {
			tool_name: 'Write',
			tool_input: {
				file_path: 'src/sketch.ts',
				content: 'const el = document.querySelector("canvas");\n',
			},
		};
		const domInPage = {
			tool_name: 'Write',
			tool_input: {
				file_path: 'src/page.ts',
				content: 'const el = document.querySelector("canvas");\n',
			},
		};

		for (const { run, bash, edit } of [
			{ run: runClaude, bash: claudeBash, edit: claudeEdit },
			{ run: runCodex, bash: codexBash, edit: codexEdit },
		]) {
			const refused = run(bash, { tool_name: 'Bash', tool_input: { command: 'sleep 5' } });
			expect(refused.status).toBe(2);
			expect(refused.stderr).toContain('do not wait with sleep');

			const poll = run(bash, {
				tool_name: 'Bash',
				tool_input: { command: 'until curl -s localhost:5173; do sleep 1; done' },
			});
			expect(poll.status).toBe(2);
			expect(poll.stderr).toContain('do not wait with sleep');

			const allowed = run(bash, {
				tool_name: 'Bash',
				tool_input: { command: 'bun run build' },
			});
			expect(allowed.status).toBe(0);
			expect(allowed.stderr).toBe('');

			const flagged = run(edit, domInSketch);
			expect(flagged.status).toBe(0);
			expect(flagged.stdout).toContain('has no DOM');

			const allowedPage = run(edit, domInPage);
			expect(allowedPage.status).toBe(0);
			expect(allowedPage.stdout).toBe('');
		}

		const patch = runCodex(codexEdit, {
			tool_name: 'apply_patch',
			tool_input: {
				command:
					'*** Begin Patch\n*** Add File: src/scene/sketch.ts\n+const el = document.body;\n*** End Patch',
			},
		});
		expect(patch.status).toBe(0);
		expect(patch.stdout).toContain('has no DOM');

		const twoFiles = runCodex(codexEdit, {
			tool_name: 'apply_patch',
			tool_input: {
				command: [
					'*** Begin Patch',
					'*** Add File: src/scene/page.ts',
					'+const el = document.body;',
					'*** Add File: src/scene/sketch.ts',
					'+const el = document.body;',
					'*** End Patch',
				].join('\n'),
			},
		});
		expect(twoFiles.status).toBe(0);
		expect(twoFiles.stdout).toContain('src/scene/sketch.ts');
	});

	it('makes a name that npm accepts from the folder', () => {
		expect(packageNameFor('/tmp/My Game!')).toBe('my-game');
		expect(packageNameFor('/tmp/.hidden')).toBe('hidden');
		expect(packageNameFor('/tmp/---')).toBe('null3d-project');
	});

	it('uses an empty folder, and refuses a folder with files', () => {
		const root = tempRoot();
		const empty = join(root, 'empty');
		mkdirSync(empty);
		expect(createProject({ dir: empty, version: '0.1.0' })).toBe(empty);

		const full = join(root, 'full');
		mkdirSync(full);
		writeFileSync(join(full, 'notes.txt'), 'keep me\n');
		expect(() => createProject({ dir: full, version: '0.1.0' })).toThrow(
			`"${full}" is not empty, and create needs an empty folder`,
		);
	});

	it('refuses a template that it does not ship', () => {
		const root = tempRoot();
		expect(() => createProject({ dir: join(root, 'game'), template: 'missing' })).toThrow(
			'it has no "missing" template; its templates: empty',
		);
	});

	it('leaves an existing agent settings file as it is', () => {
		const root = tempRoot();
		const target = join(root, 'game');
		mkdirSync(join(target, '.claude'), { recursive: true });
		const settings = join(target, '.claude', 'settings.json');
		const own = '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[]}]}}\n';
		writeFileSync(settings, own);

		expect(() => createProject({ dir: target, version: '0.1.0' })).toThrow('.claude/settings.json');
		expect(readFileSync(settings, 'utf8')).toBe(own);
		expect(readdirSync(join(target, '.claude'))).toEqual(['settings.json']);
	});

	it('leaves an existing Codex hooks file as it is', () => {
		const root = tempRoot();
		const target = join(root, 'game');
		mkdirSync(join(target, '.codex'), { recursive: true });
		const hooks = join(target, '.codex', 'hooks.json');
		const own = '{"hooks":{"PreToolUse":[]}}\n';
		writeFileSync(hooks, own);

		expect(() => createProject({ dir: target, version: '0.1.0' })).toThrow('.codex/hooks.json');
		expect(readFileSync(hooks, 'utf8')).toBe(own);
	});

	it('does not overwrite the settings of a project that it made before', () => {
		const root = tempRoot();
		const target = join(root, 'game');
		createProject({ dir: target, version: '0.1.0' });
		const settings = join(target, '.claude', 'settings.json');
		const before = readFileSync(settings, 'utf8');

		expect(() => createProject({ dir: target, version: '0.2.0' })).toThrow('.claude/settings.json');
		expect(readFileSync(settings, 'utf8')).toBe(before);
	});

	it('ships a template with the agent files', () => {
		expect(templateNames()).toContain('empty');
	});
});
