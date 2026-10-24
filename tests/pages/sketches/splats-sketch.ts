// Gaussian splats drawn from an SPZ file that the sketch makes: a knot of coloured splats above a
// ground, with a bar in front of part of it. The splats hide behind the bar and fade where they meet
// the ground, so the picture shows that they mix with meshes by depth. The camera, the splats and
// the clock stand still, so every GPU path and thread mode draws the same frame.
//
// The sketch builds the cloud in code, writes it as a version 3 SPZ file, gzips it as a writer does,
// and gives the add-on its address: the decode, the cut, the job worker's selection and the draw all
// run as they would for any other file. With `?stream=1` the sketch instead names a stream index
// that the test server serves, and the add-on downloads only the chunks that the view needs.
import { defineSketch } from '@null3d/engine';
import { createSplats, type Splats } from '../../../packages/splats/src/index';
import { splatCloud } from '../../lib/splat-cloud';

/** The page's switches: `splats` changes the cloud's size, `budget` caps the draw, `stream` streams. */
const params = new URL(import.meta.url).searchParams;
const COUNT = Number(params.get('splats') ?? 36_000);
const BUDGET = Number(params.get('budget') ?? 0);
const STREAM = params.get('stream') === '1';

/** A quaternion in the smallest-three form: two bits name the largest component, and the others follow. */
function quaternionWord(q: ArrayLike<number>): number {
	const values = [q[0] as number, q[1] as number, q[2] as number, q[3] as number];
	if ((values[3] as number) < 0) for (let k = 0; k < 4; k++) values[k] = -(values[k] as number);
	let largest = 0;
	for (let k = 1; k < 4; k++)
		if (Math.abs(values[k] as number) > Math.abs(values[largest] as number)) largest = k;
	const sign = (values[largest] as number) < 0 ? -1 : 1;
	let word = largest << 30;
	let shift = 0;
	for (let k = 3; k >= 0; k--) {
		if (k === largest) continue;
		const value = (values[k] as number) * sign;
		const magnitude = Math.min(511, Math.round((Math.abs(value) / Math.SQRT1_2) * 511));
		word |= (((value < 0 ? 1 : 0) << 9) | magnitude) << shift;
		shift += 10;
	}
	return word >>> 0;
}

/** A version 3 SPZ file of the cloud, before gzip. */
function spzFile(data: ReturnType<typeof splatCloud>): Uint8Array {
	const header = 16;
	const bytes = new Uint8Array(header + COUNT * (3 * 3 + 1 + 3 + 3 + 4));
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x5053474e, true);
	view.setUint32(4, 3, true);
	view.setUint32(8, COUNT, true);
	bytes[12] = 0;
	bytes[13] = 12;
	let at = header;
	const fixed = (value: number) => {
		const raw = Math.round(value * 4096);
		bytes[at] = raw & 0xff;
		bytes[at + 1] = (raw >> 8) & 0xff;
		bytes[at + 2] = (raw >> 16) & 0xff;
		at += 3;
	};
	for (let i = 0; i < COUNT; i++)
		for (let k = 0; k < 3; k++) fixed(data.positions[i * 3 + k] as number);
	for (let i = 0; i < COUNT; i++)
		bytes[at++] = Math.round((data.colors[i * 4 + 3] as number) * 255);
	for (let i = 0; i < COUNT; i++)
		for (let k = 0; k < 3; k++) {
			// The file stores a colour as its first band: the inverse of the reader's own step.
			const linear = data.colors[i * 4 + k] as number;
			const display = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
			const dc = (display - 0.5) / 0.2820947917738781;
			bytes[at++] = Math.round(Math.min(Math.max(dc * 0.15 * 255 + 127.5, 0), 255));
		}
	for (let i = 0; i < COUNT; i++)
		for (let k = 0; k < 3; k++) {
			const logScale = Math.log(data.scales[i * 3 + k] as number);
			bytes[at++] = Math.round(Math.min(Math.max((logScale + 10) * 16, 0), 255));
		}
	for (let i = 0; i < COUNT; i++) {
		view.setUint32(at, quaternionWord(data.rotations.subarray(i * 4, i * 4 + 4)), true);
		at += 4;
	}
	return bytes;
}

/** The gzip stream that a writer stores an SPZ file in. */
async function gzip(bytes: Uint8Array): Promise<Blob> {
	const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
	return new Blob([await new Response(stream).arrayBuffer()]);
}

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, page } = ctx;
	scene.setBackground('#0a0d14');
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 60,
		position: [4.2, 3, 4.2],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	// A ground and a bar: the splats behind the bar disappear, and those that meet the ground fade.
	scene.createMesh({
		mesh: geometry.box({ width: 12, height: 0.1, depth: 12 }),
		material: materials.standard({ color: '#20242c', roughness: 0.9 }),
		position: [0, -1.15, 0],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.16, height: 1.4, depth: 0.16 }),
		material: materials.standard({ color: '#e8e2d8', roughness: 0.6 }),
		position: [-0.6, 0.1, 1.1],
	});
	let splats: Splats;
	if (STREAM) {
		const index = new URL(`/splat-stream/gen/${COUNT}/index.json`, location.href);
		splats = await createSplats(ctx, { url: index, softness: 0.3 });
	} else {
		const address = URL.createObjectURL(await gzip(spzFile(splatCloud(COUNT))));
		splats = await createSplats(ctx, { url: address, softness: 0.3 });
	}
	if (BUDGET > 0) splats.setBudget(BUDGET);
	const eye = [0, 0, 0];
	camera.getPosition(eye);
	// A stream needs the view before it can know which chunks to fetch; a file's cut arrives first.
	if (STREAM) {
		splats.update(eye);
		await splats.ready;
	} else {
		await splats.ready;
		splats.update(eye);
	}
	await splats.settle();
	// The selection tells a page how much of the cloud draws against the budget that the preset
	// gives, so a device check can compare the two. A report waits for a packed selection, so a
	// change of the budget never reports the count that the pack before it left.
	let lastDrawn = -1;
	/** The preset's budget, or the lower cap that the page asked for. */
	const cap = (): number =>
		BUDGET > 0
			? Math.min(BUDGET, splats.feature.settings.drawn as number)
			: (splats.feature.settings.drawn as number);
	const report = (): void => {
		lastDrawn = splats.drawn;
		page.post('splats', {
			total: splats.total,
			drawn: lastDrawn,
			chunks: splats.chunks,
			loaded: splats.loaded,
			failed: splats.failed,
			budget: cap(),
			bytes: splats.bytes,
			loadedBytes: splats.loadedBytes,
		});
	};
	report();
	return {
		onUpdate() {
			splats.update(eye);
			if (splats.drawn !== lastDrawn) report();
		},
	};
});
