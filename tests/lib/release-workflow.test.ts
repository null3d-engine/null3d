import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const RELEASE = join(WORKFLOWS, 'release.yml');
const GUIDE = '.dev/releases.md';

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

// The owner chose one release workflow with no pull request (.dev/releases.md, "Making a release").
// Main's rule refuses the default token's push, so the release GitHub App lands the version commit
// ("One-time setup"). Publishing to npm through trusted publishing also fixes the workflow's file
// name, which the guide names.
describe('the Release workflow', () => {
	it('is one workflow, which opens no pull request', () => {
		expect(existsSync(join(WORKFLOWS, 'release-publish.yml'))).toBe(false);
		expect(readFileSync(RELEASE, 'utf8')).not.toMatch(/^\s{2}pull_request:/m);
	});

	it('lands the version commit and pushes the tag with the release App, whose key only main may read', () => {
		const text = readFileSync(RELEASE, 'utf8');
		expect(text).toContain('environment: release');
		expect(text).toContain('uses: actions/create-github-app-token@');
		expect(text).toContain('secrets.RELEASE_APP_PRIVATE_KEY');
		// The tag's commit keeps the released commit's workflow files, which may differ from main's.
		expect(text).toContain('permission-workflows: write');
		// The App's token replaces the checkout's header, so no push sends the default token.
		expect(text).toContain('git config --local --unset-all http.https://github.com/.extraheader');
		expect(text).toContain('x-access-token:%s\' "$APP_TOKEN"');
		expect(text).toContain('git push origin HEAD:main');
		expect(text).toMatch(/git push origin "refs\/tags\/\$\{VERSION\}"/);
		// A token lasts an hour, so it is made after the shader set, just before the pushes.
		const steps = [
			"Write the release's shader set",
			"Get the release App's token",
			"Push with the release App's token",
			'Land the version on main',
			'Tag the release',
		];
		const at = steps.map((name) => text.indexOf(`- name: ${name}`));
		expect(at.every((index) => index !== -1)).toBe(true);
		expect(at).toEqual([...at].sort((a, b) => a - b));
	});

	it('lands nothing when main already holds the version from an earlier run', () => {
		const text = readFileSync(RELEASE, 'utf8');
		const land = text.slice(
			text.indexOf('- name: Land the version on main'),
			text.indexOf('- name: Tag the release'),
		);
		const moved = land.slice(land.indexOf('git checkout -q -B release-version origin/main'));
		expect(moved.indexOf('git diff --cached --quiet')).toBeGreaterThan(-1);
		expect(moved.indexOf('git diff --cached --quiet')).toBeLessThan(moved.indexOf('git commit'));
	});

	it('publishes through the workflow file that the guide names as the trusted publisher', () => {
		const named = [...read(GUIDE).matchAll(/`([\w-]+\.ya?ml)`/g)].map(([, file]) => file!);
		expect(named).toContain('release.yml');
		for (const file of new Set(named))
			expect(existsSync(join(WORKFLOWS, file)), `${GUIDE} names ${file}`).toBe(true);
		// npm trusted publishing needs the OIDC token that only the publishing job asks for.
		expect(readFileSync(RELEASE, 'utf8')).toContain('id-token: write');
	});

	it('releases a commit that a full CI run passed, and writes the generated files', () => {
		const text = readFileSync(RELEASE, 'utf8');
		for (const step of [
			'--workflow=ci.yml', // the full CI run of the released commit
			'bun run release --release-type', // the version and the changelog section
			'bun tools/generate.ts --stage', // the files that the tag holds and main does not
		])
			expect(text, step).toContain(step);
	});

	it("builds the shaders from CI's caches and reuses a set that an earlier release packed", () => {
		const parsed = Bun.YAML.parse(readFileSync(RELEASE, 'utf8')) as {
			env?: Record<string, unknown>;
			jobs: {
				release: {
					env?: Record<string, unknown>;
					steps: { name?: string; uses?: string; run?: string; with?: Record<string, string> }[];
				};
			};
		};
		const { steps, env } = parsed.jobs.release;
		const build = steps.find((step) => step.uses === './.github/actions/shaders');
		expect(build?.with?.run).toBe('bun run shaders');
		expect(steps.some((step) => step.run?.trim() === 'bun run shaders')).toBe(false);
		// The release only reads the shader caches: it never saves a module set or entries of its own.
		expect(parsed.env?.SAVE_CACHES).toBeUndefined();
		expect(env?.SAVE_CACHES).toBeUndefined();

		const restore = steps.find((step) => step.name === 'Restore the packed shader set');
		const save = steps.find((step) => step.name === 'Save the packed shader set');
		expect(restore?.uses).toStartWith('actions/cache/restore@');
		expect(save?.uses).toStartWith('actions/cache/save@');
		// The key names the module set and the code that picks and packs its files, never the version.
		expect(restore?.with?.key).toContain('steps.shader-set.outputs.name');
		expect(restore?.with?.key).toContain('tools/lib/shader-artifact.ts');
		expect(restore?.with?.key).toContain('tools/lib/shader-modules.ts');
		expect(restore?.with?.key).not.toContain('version');
		const order = [
			build,
			restore,
			steps.find((step) => step.name === "Write the release's shader set"),
			save,
			steps.find((step) => step.name === 'Land the version on main'),
		].map((step) => steps.indexOf(step!));
		expect(order.every((index) => index !== -1)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});
	it('publishes an existing tag without a release, and builds the npm job from the shader caches', () => {
		const parsed = Bun.YAML.parse(readFileSync(RELEASE, 'utf8')) as {
			on: { workflow_dispatch: { inputs: Record<string, unknown> } };
			jobs: Record<
				string,
				{
					if?: string;
					env?: Record<string, string>;
					steps?: { uses?: string; run?: string; with?: Record<string, string> }[];
				}
			>;
		};
		expect(parsed.on.workflow_dispatch.inputs['publish-tag']).toBeDefined();
		const { release, 'publish-npm': npm, 'notify-website': website } = parsed.jobs;
		expect(release?.if).toContain("inputs.publish-tag == ''");
		expect(npm?.if).toContain("needs.release.result == 'skipped' && inputs.publish-tag != ''");
		expect(npm?.env?.VERSION).toContain('inputs.publish-tag');
		expect(website?.if).toContain("needs.publish-npm.result == 'success'");
		const build = npm?.steps?.find((step) => step.uses === './.github/actions/shaders');
		expect(build?.with?.run).toBe('bun tools/build-wasm.ts --pages-only');
		expect(npm?.steps?.some((step) => step.run?.includes('gh release download'))).toBe(true);
	});
});
