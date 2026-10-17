// The notice before a first build: it appears only when the compiler's entries folder holds
// nothing, which is when every shader compiles and the build takes minutes.
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { announceColdBuild } from './lib/shader-modules';

const scratchFolders: string[] = [];

/** A folder that the test may fill, removed afterwards. */
function scratch(): string {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-shader-notice-'));
	scratchFolders.push(folder);
	return folder;
}

/** Runs `run`, and gives the lines it wrote to standard error. */
function noticeLines(run: () => void): string[] {
	const lines: string[] = [];
	const original = console.error;
	console.error = ((...values: unknown[]) => {
		lines.push(values.join(' '));
	}) as typeof console.error;
	try {
		run();
	} finally {
		console.error = original;
	}
	return lines;
}

afterEach(() => {
	for (const folder of scratchFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('announceColdBuild', () => {
	it('says the first build compiles every shader when the folder is missing', () => {
		const lines = noticeLines(() => announceColdBuild(join(scratch(), 'missing')));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('The first build compiles every shader');
	});

	it('says the first build compiles every shader when the folder is empty', () => {
		const empty = join(scratch(), 'empty');
		mkdirSync(empty);
		expect(noticeLines(() => announceColdBuild(empty))).toHaveLength(1);
	});

	it('says nothing when the folder holds an entry', () => {
		const folder = scratch();
		writeFileSync(join(folder, 'entry.json'), '{}');
		expect(noticeLines(() => announceColdBuild(folder))).toHaveLength(0);
	});
});
