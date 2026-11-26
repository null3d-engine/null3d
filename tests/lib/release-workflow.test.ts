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

	it('lands the version commit on main with the release App, whose key only main may read', () => {
		const text = readFileSync(RELEASE, 'utf8');
		expect(text).toContain('environment: release');
		expect(text).toContain('uses: actions/create-github-app-token@');
		expect(text).toContain('secrets.RELEASE_APP_PRIVATE_KEY');
		// The checkout's default token header is cleared, or GitHub would read it and not the App's.
		expect(text).toContain('git -c http.https://github.com/.extraheader= \\');
		expect(text).toMatch(
			/push "https:\/\/x-access-token:\$\{APP_TOKEN\}@github\.com\/\$\{GITHUB_REPOSITORY\}\.git" HEAD:main/,
		);
		// A token lasts an hour, so it is made after the shader set, just before the push.
		const steps = [
			"Write the release's shader set",
			"Get the release App's token",
			'Land the version on main',
		];
		const at = steps.map((name) => text.indexOf(`- name: ${name}`));
		expect(at.every((index) => index !== -1)).toBe(true);
		expect(at).toEqual([...at].sort((a, b) => a - b));
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
});
