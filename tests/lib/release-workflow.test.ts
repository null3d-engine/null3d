import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const RELEASE = join(WORKFLOWS, 'release.yml');
const GUIDE = '.dev/releases.md';

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

// The owner chose one release workflow with no pull request and no GitHub App (.dev/releases.md,
// "Making a release"). Publishing to npm through trusted publishing also fixes
// the workflow's file name, which the guide names.
describe('the Release workflow', () => {
	it('is one workflow, which opens no pull request and needs no app', () => {
		expect(existsSync(join(WORKFLOWS, 'release-publish.yml'))).toBe(false);
		const text = readFileSync(RELEASE, 'utf8');
		expect(text).not.toContain('create-github-app-token');
		expect(text).not.toContain('RELEASE_APP_ID');
		expect(text).not.toMatch(/^\s{2}pull_request:/m);
		// The version commit reaches main without a pull request, so its own job pushes it.
		expect(text).toContain('git push origin HEAD:main');
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
