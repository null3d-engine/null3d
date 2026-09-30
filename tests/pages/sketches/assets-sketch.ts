// The loading calls and the texture calls in a live engine, for the assets test. The sketch loads
// files by addresses relative to the test page, preloads three of them with a progress handler,
// makes and updates textures from images and data, and records the code of each call that must
// fail. Once every texture is on the GPU, it sends the page its record. The test serves two
// addresses of other origins: one allows the page to read its file, and one does not.
import { defineSketch, EngineError } from '@null3d/engine';

/** The other origins that the test serves, one with and one without Access-Control-Allow-Origin. */
const ALLOWED = 'http://allowed.null3d.test/quadrants.png';
const BLOCKED = 'http://blocked.null3d.test/quadrants.png';

/** The code of the error that a call throws or rejects with, or 'none'. */
async function codeOf(call: () => unknown): Promise<string> {
	try {
		await call();
	} catch (error) {
		return error instanceof EngineError ? error.code : String(error);
	}
	return 'none';
}

export default defineSketch(async ({ assets, textures, page }) => {
	const progress: [number, number][] = [];
	assets.onProgress((loaded, total) => progress.push([loaded, total]));
	await assets.preload([
		'assets/textures/quadrants.png',
		'assets/textures/quadrants.webp',
		'assets/data/level.json',
	]);
	const preloaded = [...progress];
	// These take their files from memory, and download nothing more.
	const picture = await assets.loadTexture('assets/textures/quadrants.png', { wrap: 'repeat' });
	const bitmap = await assets.loadImageBitmap('assets/textures/quadrants.webp');
	const level = await assets.loadJson<{ enemies: number }>('assets/data/level.json');
	const downloadsAfterPreload = progress.length;
	const bytes = await assets.loadBinary('assets/data/level.json');
	const remote = await assets.loadTexture(ALLOWED, { colorSpace: 'linear', filter: 'nearest' });

	const fromBitmap = textures.fromImageBitmap(bitmap, { mipmaps: false });
	const layers = textures.fromData({ width: 2, height: 2, depth: 3, data: new Uint8Array(48) });
	const half = textures.fromData({
		width: 2,
		height: 1,
		format: 'rgba16float',
		data: new Float32Array([0, 0.5, 1, 1, 2, 4, 8, 1]),
	});
	// A texture from data that takes an image of another size, and new data.
	const resized = textures.fromData({ width: 1, height: 1, data: new Uint8Array(4) });
	resized.update(await assets.loadImageBitmap('assets/textures/quadrants.png'));
	layers.update(new Uint8Array(48).fill(255));
	const gone = textures.fromData({ width: 1, height: 1, data: new Uint8Array(4) });
	gone.destroy();

	const codes = {
		missing: await codeOf(() => assets.loadTexture('assets/textures/missing.png')),
		blocked: await codeOf(() => assets.loadTexture(BLOCKED)),
		notAnImage: await codeOf(() => assets.loadTexture('assets/data/level.json')),
		notJson: await codeOf(() => assets.loadJson('assets/textures/quadrants.png')),
		badOption: await codeOf(() =>
			assets.loadTexture('assets/textures/quadrants.png', { anisotropy: 32 }),
		),
		shortData: await codeOf(() =>
			textures.fromData({ width: 2, height: 2, data: new Uint8Array(4) }),
		),
		destroyed: await codeOf(() => gone.update(new Uint8Array(4))),
	};
	const made = [picture, remote, fromBitmap, layers, half, resized];
	let sent = false;
	return {
		onUpdate() {
			if (sent || textures.uploads().waiting > 0) return;
			sent = true;
			page.post('result', {
				preloaded,
				downloadsAfterPreload,
				progress,
				enemies: level.enemies,
				bytes: bytes.byteLength,
				sizes: made.map((t) => [t.width, t.height, t.depth]),
				textureBytes: made.map((t) => t.bytes),
				memoryBytes: textures.memoryBytes,
				maxSize: textures.maxSize,
				formats: [half.format, half.colorSpace, picture.colorSpace, remote.colorSpace],
				codes,
			});
		},
	};
});
