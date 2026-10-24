// Gaussian splats drawn from an SPZ file that the sketch makes: a knot of coloured splats above a
// ground, with a bar in front of part of it. The splats hide behind the bar and fade where they meet
// the ground, so the picture shows that they mix with meshes by depth. The camera, the splats and
// the clock stand still, so every GPU path and thread mode draws the same frame.
//
// The sketch builds the cloud in code, writes it as a version 3 SPZ file, gzips it as a writer does,
// and gives the add-on its address: the decode, the cut, the job worker's selection and the draw all
// run as they would for any other file.
import { color, defineSketch } from '@null3d/engine';
import { createSplats } from '../../../packages/splats/src/index';

/** The page's switches: `splats` changes the cloud's size for a slower GPU, and `budget` caps the draw. */
const params = new URL(import.meta.url).searchParams;
const COUNT = Number(params.get('splats') ?? 36_000);
const BUDGET = Number(params.get('budget') ?? 0);

/** The splats' palette, which each splat picks from. */
const PALETTE = ['#ff6b5e', '#ffc44d', '#6ee7a8', '#5bb8ff', '#c58bff', '#ff8ad8'];

/** A repeatable number from an index and a channel, from 0 to 1, without a random generator. */
function hash(index: number, channel: number): number {
	let x = (index * 374761393 + channel * 668265263) >>> 0;
	x = ((x ^ (x >>> 13)) * 1274126177) >>> 0;
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The point of a (2, 3) torus knot at `t`, lying flat above the ground, and the frame across its tube. */
function knot(t: number): { centre: number[]; across: number[]; along: number[] } {
	const r = Math.cos(3 * t) + 2;
	const centre = [r * Math.cos(2 * t), Math.sin(3 * t), r * Math.sin(2 * t)];
	const tx = -2 * r * Math.sin(2 * t) - 3 * Math.sin(3 * t) * Math.cos(2 * t);
	const ty = 3 * Math.cos(3 * t);
	const tz = 2 * r * Math.cos(2 * t) - 3 * Math.sin(3 * t) * Math.sin(2 * t);
	const length = Math.hypot(tx, ty, tz);
	const tangent = [tx / length, ty / length, tz / length];
	// Cross the tangent with the world's up axis, and keep the result's direction across the tube.
	const up = [0, 1, 0];
	const normal = [
		(tangent[1] as number) * (up[2] as number) - (tangent[2] as number) * (up[1] as number),
		(tangent[2] as number) * (up[0] as number) - (tangent[0] as number) * (up[2] as number),
		(tangent[0] as number) * (up[1] as number) - (tangent[1] as number) * (up[0] as number),
	];
	// A tangent that runs straight up has no direction across it; the world's x axis stands in.
	if (Math.hypot(normal[0] as number, normal[1] as number, normal[2] as number) < 1e-6) {
		normal[0] = 1;
		normal[1] = 0;
		normal[2] = 0;
	}
	const nl = Math.hypot(normal[0] as number, normal[1] as number, normal[2] as number) || 1;
	const n = normal.map((value) => value / nl);
	const binormal = [
		(tangent[1] as number) * (n[2] as number) - (tangent[2] as number) * (n[1] as number),
		(tangent[2] as number) * (n[0] as number) - (tangent[0] as number) * (n[2] as number),
		(tangent[0] as number) * (n[1] as number) - (tangent[1] as number) * (n[0] as number),
	];
	return { centre, across: n, along: binormal };
}

/** The cloud: splats through the tube of a knot, each with a turn of its own. */
function cloud() {
	const positions = new Float32Array(COUNT * 3);
	const scales = new Float32Array(COUNT * 3);
	const rotations = new Float32Array(COUNT * 4);
	const colors = new Float32Array(COUNT * 4);
	const linear = new Float32Array(3);
	const tube = 0.2;
	for (let i = 0; i < COUNT; i++) {
		const t = (i / COUNT) * Math.PI * 2;
		const { centre, across, along } = knot(t);
		const angle = hash(i, 1) * Math.PI * 2;
		const radius = tube * (0.7 + 0.3 * hash(i, 2));
		positions.set(
			[
				(centre[0] as number) +
					radius *
						(Math.cos(angle) * (across[0] as number) + Math.sin(angle) * (along[0] as number)),
				(centre[1] as number) +
					radius *
						(Math.cos(angle) * (across[1] as number) + Math.sin(angle) * (along[1] as number)),
				(centre[2] as number) +
					radius *
						(Math.cos(angle) * (across[2] as number) + Math.sin(angle) * (along[2] as number)),
			],
			i * 3,
		);
		const spread = 0.025 + hash(i, 3) * 0.025;
		scales.set(
			[spread, spread * (0.6 + hash(i, 4) * 0.8), spread * (0.6 + hash(i, 5) * 0.8)],
			i * 3,
		);
		const turn = [hash(i, 6) * 2 - 1, hash(i, 7) * 2 - 1, hash(i, 8) * 2 - 1, hash(i, 9) * 2 - 1];
		const turnLength = Math.hypot(...turn) || 1;
		for (let k = 0; k < 4; k++) rotations[i * 4 + k] = (turn[k] as number) / turnLength;
		const hex = PALETTE[Math.floor(hash(i, 10) * PALETTE.length) % PALETTE.length] as string;
		color.fromHex(linear, hex);
		colors.set(
			[linear[0] as number, linear[1] as number, linear[2] as number, 0.5 + hash(i, 11) * 0.4],
			i * 4,
		);
	}
	return { positions, scales, rotations, colors };
}

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
function spzFile(data: ReturnType<typeof cloud>): Uint8Array {
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
	const { scene, geometry, materials } = ctx;
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
	const address = URL.createObjectURL(await gzip(spzFile(cloud())));
	const splats = await createSplats(ctx, { url: address, softness: 0.3 });
	if (BUDGET > 0) splats.setBudget(BUDGET);
	await splats.ready;
	const eye = [0, 0, 0];
	camera.getPosition(eye);
	splats.update(eye);
	await splats.settle();
	return {};
});
