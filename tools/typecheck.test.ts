import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROJECTS, recordOf } from './typecheck';

const ROOT = join(import.meta.dirname, '..');

/** The TypeScript configs that the check leaves out, each with the reason. */
const NOT_CHECKED: Record<string, string> = {
	'tsconfig.web.base.json': 'the settings that the web projects extend, with no files of its own',
	'packages/vite-plugin/tsconfig.json': "the root project's files hold the plugin's source",
	'packages/cli/templates/empty/tsconfig.json': "a new project's config, checked in that project",
	'tests/fixtures/fresh-project/tsconfig.json':
		'the fresh-project test checks it in its own project',
};

/** The config file of a project, as the list names its folder or its file. */
const configOf = (project: string) =>
	project.endsWith('.json') ? project : `${project}/tsconfig.json`;

describe('the TypeScript check', () => {
	it('checks every TypeScript config of the repository, but those it names with a reason', () => {
		const configs = execFileSync('git', ['ls-files', '*tsconfig*.json'], {
			cwd: ROOT,
			encoding: 'utf8',
		})
			.split('\n')
			.filter((path) => path !== '');
		const checked = new Set(PROJECTS.map(configOf));
		expect(configs.filter((path) => !checked.has(path) && !(path in NOT_CHECKED))).toEqual([]);
		for (const project of PROJECTS)
			expect(existsSync(join(ROOT, configOf(project))), project).toBe(true);
		for (const path of Object.keys(NOT_CHECKED)) expect(configs, path).toContain(path);
	});

	it("keeps each project's incremental record in a file of its own", () => {
		const records = PROJECTS.map(recordOf);
		expect(new Set(records).size).toBe(PROJECTS.length);
		for (const record of records) expect(dirname(record)).toBe(join(ROOT, 'target/typecheck'));
	});
});
