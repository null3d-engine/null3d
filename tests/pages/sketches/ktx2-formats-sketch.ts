// KTX2 files in a live engine, for the KTX2 test. The sketch loads the ETC1S file twice at once,
// the UASTC file with alpha, the ramp whose size takes no compressed format, and the ETC1S file
// without its mip levels. It records the code of each call that must fail. Once every texture is
// on the GPU, it sends the page the format, color space, size and GPU bytes of each texture. The
// files' addresses come from the sketch module's own, so a production build ships them.
import { defineSketch, EngineError } from '@null3d/engine';

const ETC1S = new URL('../assets/textures/quarters-etc1s.ktx2', import.meta.url);
const UASTC = new URL('../assets/textures/quarters-uastc.ktx2', import.meta.url);
const RAMP = new URL('../assets/textures/ramp-uastc.ktx2', import.meta.url);

/** The code of the error that a call throws or rejects with, or 'none'. */
async function codeOf(call: () => unknown): Promise<string> {
	try {
		await call();
	} catch (error) {
		return error instanceof EngineError ? error.code : String(error);
	}
	return 'none';
}

/** A file that starts as a KTX2 file and breaks off after its identifier. */
function brokenFile(): string {
	const bytes = new Uint8Array([
		0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	return URL.createObjectURL(new Blob([bytes, new Uint8Array(40)]));
}

export default defineSketch(async ({ assets, textures, page }) => {
	const made = await Promise.all([
		assets.loadTexture(ETC1S),
		assets.loadTexture(ETC1S, { wrap: 'repeat' }),
		assets.loadTexture(UASTC),
		assets.loadTexture(RAMP),
		assets.loadTexture(ETC1S, { mipmaps: false }),
	]);
	const broken = brokenFile();
	const codes = {
		broken: await codeOf(() => assets.loadTexture(broken)),
		flipY: await codeOf(() => assets.loadTexture(ETC1S, { flipY: true })),
		update: await codeOf(() => made[0]?.update(new Uint8Array(64 * 64 * 4))),
	};
	URL.revokeObjectURL(broken);
	let sent = false;
	return {
		onUpdate() {
			if (sent || textures.uploads().waiting > 0) return;
			sent = true;
			page.post('result', {
				textures: made.map((t) => ({
					format: t.format,
					colorSpace: t.colorSpace,
					size: [t.width, t.height, t.depth],
					bytes: t.bytes,
				})),
				memoryBytes: textures.memoryBytes,
				codes,
			});
		},
	};
});
