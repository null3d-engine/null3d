import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRACO_FILES, DRACO_VENDOR } from './draco-vendor';

/** The files of the copy that the engine's own code adds: the types of the decoder's script. */
const OWN_FILES = ['draco_wasm_wrapper_gltf.d.ts'];

describe("the repository's copy of Draco's decoder", () => {
	it('holds the pinned release files unchanged, and nothing else', () => {
		for (const file of DRACO_FILES) {
			const bytes = readFileSync(join(DRACO_VENDOR, file.name));
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
		}
		expect(readdirSync(DRACO_VENDOR).sort()).toEqual(
			[...DRACO_FILES.map((file) => file.name), ...OWN_FILES].sort(),
		);
	});
});
