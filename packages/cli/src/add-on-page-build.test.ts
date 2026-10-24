// The build that the add-on check reads its figures from: a production build of the fixture's page,
// with the source maps that name each function. The page imports the engine from source, so the
// build holds the generated shaders, and a map that embedded its sources would copy hundreds of
// megabytes of text. This check holds the build to the maps that the gate reads, and the heavy run's
// memory ceiling holds the build to the figure that its own run measured.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startBuildServer } from './server.js';

/** The fixture's page, which imports the engine and starts a sketch. */
const FIXTURE = join(import.meta.dirname, '../../../tests/fixtures/d9-addon');

/** The paths of the source maps under `folder`. */
function mapFiles(folder: string): string[] {
	const maps: string[] = [];
	for (const entry of readdirSync(folder, { withFileTypes: true })) {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) maps.push(...mapFiles(path));
		else if (entry.name.endsWith('.map')) maps.push(path);
	}
	return maps;
}

describe('a page build with source maps', () => {
	test('writes a map for each built file, and the maps hold little source text', async () => {
		const cwd = process.cwd();
		process.chdir(FIXTURE);
		try {
			const server = await startBuildServer({ sourcemap: true });
			try {
				const maps = mapFiles(server.buildDir as string);
				expect(maps.length).toBeGreaterThan(0);
				let bytes = 0;
				for (const path of maps) {
					const map = JSON.parse(readFileSync(path, 'utf8'));
					expect(map.sources.length).toBeGreaterThan(0);
					expect(map.mappings.length).toBeGreaterThan(0);
					bytes += statSync(path).size;
				}
				// The engine's generated shaders are hundreds of megabytes of source. A map that
				// embedded them would put this build far past the figure; on 24 October 2026 the maps
				// of this build made 10 MB.
				expect(bytes).toBeLessThan(64 * 1024 * 1024);
			} finally {
				await server.close();
			}
		} finally {
			process.chdir(cwd);
		}
	}, 600_000);
});
