import { afterEach, describe, expect, it } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

		for (const file of [
			'package.json',
			'index.html',
			'src/page.ts',
			'src/sketch.ts',
			'tsconfig.json',
			'vite.config.ts',
			'AGENTS.md',
			'.gitignore',
			'.claude/settings.json',
			'.claude/agent-hook.mjs',
		]) {
			expect(existsSync(join(target, file))).toBe(true);
		}

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

	it('turns the hook on for commands and for edits', () => {
		const root = tempRoot();
		const target = createProject({ dir: join(root, 'my-game'), version: '0.1.0' });
		const settings = JSON.parse(readFileSync(join(target, '.claude/settings.json'), 'utf8'));
		const hooks = settings.hooks.PreToolUse;

		expect(hooks.map((hook: { matcher: string }) => hook.matcher)).toEqual([
			'Bash',
			'Edit|Write|MultiEdit',
		]);
		expect(hooks[0].hooks[0].command).toContain('.claude/agent-hook.mjs" bash');
		expect(hooks[1].hooks[0].command).toContain('.claude/agent-hook.mjs" edit');
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
