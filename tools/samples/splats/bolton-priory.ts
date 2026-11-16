// Builds the splat stream of the Bolton Priory scan for the sample-assets repository, from the SOG
// file that its author published there:
//
//   bun tools/samples/splats/bolton-priory.ts <output folder>
//
// 1. Reads the pinned SOG file from the sample cache: a zip of lossless WebP images and a
//    description of how their bytes map to each splat's center, rotation, spread, color and opacity.
// 2. Decodes each image with libwebp's own decoder, `dwebp`, which gives every byte exactly. A
//    browser decoder may scale a pixel's color by its alpha, and every splat's color pixel here is
//    partly transparent, so it would change the colors.
// 3. Turns the cloud upright: the training wrote it with its vertical axis pointing down, and the
//    engine's points up. It then moves the ground to height 0 and the site's middle over the origin.
// 4. Keeps the first spherical-harmonic band, which is all the splats add-on draws, cuts the cloud
//    into chunks with the add-on's cutter, writes each chunk as an SPZ file with its writer, and
//    names the chunks in a stream index.
//
// DWEBP names the decoder's executable, which defaults to the one on the path (`brew install webp`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chunkSplats } from '../../../packages/splats/src/chunks.ts';
import { colorOfSh, type SplatData } from '../../../packages/splats/src/format.ts';
import { encodeSpz } from '../../../packages/splats/src/spz-write.ts';
import { samplePath } from '../../lib/samples.ts';

const DWEBP = process.env.DWEBP ?? 'dwebp';
const STREAM_FORMAT = 'null3d.splats.stream';

/** The parts of a SOG description, version 2, that the first color band needs. */
interface SogMeta {
	version: number;
	count: number;
	means: { mins: number[]; maxs: number[]; files: [string, string] };
	scales: { codebook: number[]; files: [string] };
	quats: { files: [string] };
	sh0: { codebook: number[]; files: [string] };
}

/** The bytes of one file of the zip, which `unzip` reads. */
function unzipped(zip: string, name: string): Uint8Array {
	const run = Bun.spawnSync(['unzip', '-p', zip, name], { stdout: 'pipe', stderr: 'pipe' });
	if (run.exitCode !== 0) throw new Error(`unzip could not read ${name}: ${run.stderr}`);
	return run.stdout;
}

/** The RGBA bytes of a WebP image, row by row from the top, as libwebp decodes them. */
function pixels(zip: string, name: string, count: number): Uint8Array {
	const run = Bun.spawnSync([DWEBP, '-quiet', '-pam', '-o', '-', '--', '-'], {
		stdin: unzipped(zip, name),
		stdout: 'pipe',
		stderr: 'pipe',
	});
	if (run.exitCode !== 0) throw new Error(`${DWEBP} could not decode ${name}: ${run.stderr}`);
	const pam = run.stdout;
	const end = new TextDecoder().decode(pam.subarray(0, 200)).indexOf('ENDHDR\n');
	if (end < 0) throw new Error(`${DWEBP} wrote no PAM header for ${name}`);
	const header = new TextDecoder().decode(pam.subarray(0, end));
	if (!/DEPTH 4/.test(header)) throw new Error(`${name} did not decode to RGBA: ${header}`);
	const data = pam.subarray(end + 7);
	if (data.length < count * 4) throw new Error(`${name} holds fewer pixels than ${count} splats`);
	return data;
}

/** The cloud that the SOG file describes, as the training wrote it. */
function readSog(zip: string): SplatData {
	const meta = JSON.parse(new TextDecoder().decode(unzipped(zip, 'meta.json'))) as SogMeta;
	if (meta.version !== 2) throw new Error(`the SOG file is version ${meta.version}; this reads 2`);
	const { count } = meta;
	const lower = pixels(zip, meta.means.files[0], count);
	const upper = pixels(zip, meta.means.files[1], count);
	const quats = pixels(zip, meta.quats.files[0], count);
	const scaleIndices = pixels(zip, meta.scales.files[0], count);
	const sh0 = pixels(zip, meta.sh0.files[0], count);
	const data = {
		count,
		positions: new Float32Array(count * 3),
		scales: new Float32Array(count * 3),
		rotations: new Float32Array(count * 4),
		colors: new Float32Array(count * 4),
	};
	const dc: [number, number, number] = [0, 0, 0];
	const wxyz = [0, 0, 0, 0];
	for (let i = 0; i < count; i++) {
		const px = i * 4;
		for (let k = 0; k < 3; k++) {
			// Sixteen bits between the bounds, in a symmetric log space that keeps the near detail.
			const q = (((upper[px + k] as number) << 8) | (lower[px + k] as number)) / 65535;
			const min = meta.means.mins[k] as number;
			const n = min + ((meta.means.maxs[k] as number) - min) * q;
			data.positions[i * 3 + k] = Math.sign(n) * (Math.exp(Math.abs(n)) - 1);
			data.scales[i * 3 + k] = Math.exp(
				meta.scales.codebook[scaleIndices[px + k] as number] as number,
			);
			dc[k] = meta.sh0.codebook[sh0[px + k] as number] as number;
		}
		colorOfSh(dc, true, data.colors.subarray(i * 4, i * 4 + 3));
		data.colors[i * 4 + 3] = (sh0[px + 3] as number) / 255;
		// The smallest-three rotation in w, x, y, z terms: the alpha names the largest component,
		// which is left out, and the three stored ones follow it in turn, wrapping from z to w.
		const omitted = (quats[px + 3] as number) - 252;
		if (omitted < 0 || omitted > 3) throw new Error(`splat ${i} has no valid rotation mode`);
		let sum = 0;
		for (let stored = 0; stored < 3; stored++) {
			const value = ((quats[px + stored] as number) / 255 - 0.5) * Math.SQRT2;
			wxyz[(omitted + 1 + stored) % 4] = value;
			sum += value * value;
		}
		wxyz[omitted] = Math.sqrt(Math.max(0, 1 - sum));
		const norm = Math.hypot(
			wxyz[0] as number,
			wxyz[1] as number,
			wxyz[2] as number,
			wxyz[3] as number,
		);
		data.rotations[i * 4] = (wxyz[1] as number) / norm;
		data.rotations[i * 4 + 1] = (wxyz[2] as number) / norm;
		data.rotations[i * 4 + 2] = (wxyz[3] as number) / norm;
		data.rotations[i * 4 + 3] = (wxyz[0] as number) / norm;
	}
	return data;
}

/**
 * Turns the cloud half a turn about the x axis, so its up points along +y, then moves the ground to
 * height 0 and the middle of the site over the origin.
 */
function upright(data: SplatData): void {
	const { count, positions, rotations, colors } = data;
	for (let i = 0; i < count; i++) {
		positions[i * 3 + 1] = -(positions[i * 3 + 1] as number);
		positions[i * 3 + 2] = -(positions[i * 3 + 2] as number);
		// The half turn about x, applied before the splat's own rotation: (x, y, z, w) becomes
		// (w, -z, y, -x).
		const x = rotations[i * 4] as number;
		const y = rotations[i * 4 + 1] as number;
		const z = rotations[i * 4 + 2] as number;
		const w = rotations[i * 4 + 3] as number;
		rotations[i * 4] = w;
		rotations[i * 4 + 1] = -z;
		rotations[i * 4 + 2] = y;
		rotations[i * 4 + 3] = -x;
	}
	// The ground is the height that the most solid splats share, to a tenth of a unit.
	const heights = new Map<number, number>();
	for (let i = 0; i < count; i++) {
		if ((colors[i * 4 + 3] as number) < 0.5) continue;
		const bin = Math.round((positions[i * 3 + 1] as number) * 10);
		heights.set(bin, (heights.get(bin) ?? 0) + 1);
	}
	let ground = 0;
	let most = -1;
	for (const [bin, n] of heights)
		if (n > most || (n === most && bin < ground)) {
			most = n;
			ground = bin;
		}
	// The middle of the site is the middle of the range that holds all but the outermost
	// hundredth of the splats on each side, so a few stray splats far out do not move it.
	const middle = (axis: number): number => {
		const values = new Float32Array(count);
		for (let i = 0; i < count; i++) values[i] = positions[i * 3 + axis] as number;
		values.sort();
		return (
			((values[Math.floor(count * 0.01)] as number) +
				(values[Math.floor(count * 0.99)] as number)) /
			2
		);
	};
	const shift = [middle(0), ground / 10, middle(2)];
	for (let i = 0; i < count; i++)
		for (let k = 0; k < 3; k++)
			positions[i * 3 + k] = (positions[i * 3 + k] as number) - (shift[k] as number);
	console.log(`moved the ground from ${shift[1]} and the middle from (${shift[0]}, ${shift[2]})`);
}

const out = process.argv[2];
if (!out)
	throw new Error('give the output folder: bun tools/samples/splats/bolton-priory.ts <folder>');
const folder = resolve(out);
mkdirSync(folder, { recursive: true });

const cloud = readSog(samplePath('sources/splats/bolton-priory/bolton-priory.sog'));
upright(cloud);
const { chunks } = await chunkSplats(cloud);
const files = await Promise.all(chunks.map((chunk) => encodeSpz(chunk)));
const index = {
	format: STREAM_FORMAT,
	version: 1,
	count: cloud.count,
	chunks: chunks.map((chunk, i) => ({
		url: `chunk-${i}.spz`,
		count: chunk.count,
		center: chunk.center,
		radius: chunk.radius,
		bytes: (files[i] as Uint8Array).byteLength,
	})),
};
for (const [i, file] of files.entries()) writeFileSync(join(folder, `chunk-${i}.spz`), file);
writeFileSync(join(folder, 'index.json'), `${JSON.stringify(index, null, '\t')}\n`);
const bytes = files.reduce((sum, file) => sum + file.byteLength, 0);
console.log(
	`${cloud.count} splats in ${chunks.length} chunks, ${(bytes / 1e6).toFixed(2)} MB, in ${folder}`,
);
