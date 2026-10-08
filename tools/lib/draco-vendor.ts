// Draco's decoder for glTF files, as Google builds and publishes it: the glTF-only build of the
// release that the engine pins, from the release tag's `javascript/` folder. The repository keeps
// the files unchanged in packages/engine/vendor/draco. `bun tools/vendor-draco.ts` downloads them
// again and checks each one's SHA-256, and a unit test checks the kept copy against the same hashes.
import { join } from 'node:path';

/** The repository's copy of the decoder. */
export const DRACO_VENDOR = join(import.meta.dirname, '../../packages/engine/vendor/draco');

/** The Draco release, and the commit that its tag names. */
export const DRACO_RELEASE = {
	version: '1.5.7',
	commit: '8786740086a9f4d83f44aa83badfbea4dce7a1b5',
};

/** Each file of the copy, with its path in Draco's repository and its SHA-256. */
export const DRACO_FILES: readonly { name: string; path: string; sha256: string }[] = [
	{
		name: 'draco_wasm_wrapper_gltf.js',
		path: 'javascript/draco_wasm_wrapper_gltf.js',
		sha256: '8bb2952d2ba7d67e1414f8df819410cb0434a666be53f671fff75f68843d76f6',
	},
	{
		name: 'draco_decoder_gltf.wasm',
		path: 'javascript/draco_decoder_gltf.wasm',
		sha256: '712db3449ae2041d6e8a224c395bda6cedb49e51322fae38b7db9beb8b381889',
	},
	{
		name: 'LICENSE',
		path: 'LICENSE',
		sha256: 'd3709b0fb4b8a94bbb1d02b8a2e484f258b0d9c5c5a01f940391f3fe662cd1a4',
	},
];

/** The address of a file of the pinned release in Draco's repository. */
export function dracoFileUrl(path: string): string {
	return `https://raw.githubusercontent.com/google/draco/${DRACO_RELEASE.commit}/${path}`;
}
