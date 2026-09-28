import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A temporary directory holding the given files, keyed by relative path, for tests. */
export function fixture(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'null3d-tools-'));
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
}
