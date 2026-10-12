// Builds the Creek's models for the sample-assets repository, from the Blender script beside this
// file to the files that the scene loads:
//
//   bun tools/samples/blender/creek.ts <output folder>
//
// 1. Blender runs creek.py headless, which writes trees.glb, plants.glb and cave.glb.
// 2. The asset tool optimizes each one, as a project's build would: quantized meshes compressed
//    with meshopt, and KTX2 textures.
// 3. Each optimized model takes its KTX2 textures into its own binary chunk, so one file holds the
//    whole model. A page then loads it by its address alone, and a build copies one file.
//
// BLENDER names Blender's executable, which defaults to the macOS app's.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { run as optimize } from '../../../packages/cli/src/assets/optimize.js';

const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const MODELS = ['trees', 'plants', 'cave'] as const;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

interface Gltf {
	images?: { uri?: string; bufferView?: number; mimeType?: string }[];
	bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
	buffers?: { byteLength: number; uri?: string }[];
	nodes?: { name?: string; mesh?: number }[];
	meshes?: { primitives: { indices?: number }[] }[];
	accessors?: { count: number }[];
}

/** The JSON and the binary chunk of a binary glTF file. */
function readGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const jsonLength = view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
	const at = 20 + jsonLength;
	const bin =
		at + 8 <= bytes.length && view.getUint32(at + 4, true) === BIN_CHUNK
			? bytes.subarray(at + 8, at + 8 + view.getUint32(at, true))
			: new Uint8Array(0);
	return { json, bin };
}

function writeGlb(json: Gltf, bin: Uint8Array): Uint8Array {
	const pad = (n: number) => (4 - (n % 4)) % 4;
	const text = new TextEncoder().encode(JSON.stringify(json));
	const jsonBytes = new Uint8Array(text.length + pad(text.length)).fill(0x20);
	jsonBytes.set(text);
	const binBytes = new Uint8Array(bin.length + pad(bin.length));
	binBytes.set(bin);
	const out = new Uint8Array(12 + 8 + jsonBytes.length + 8 + binBytes.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.length, true);
	view.setUint32(12, jsonBytes.length, true);
	view.setUint32(16, JSON_CHUNK, true);
	out.set(jsonBytes, 20);
	view.setUint32(20 + jsonBytes.length, binBytes.length, true);
	view.setUint32(24 + jsonBytes.length, BIN_CHUNK, true);
	out.set(binBytes, 28 + jsonBytes.length);
	return out;
}

/** Moves each image that the model names by address into its binary chunk, after its other data. */
function pack(file: string): Uint8Array {
	const { json, bin } = readGlb(readFileSync(file));
	const parts = [bin];
	let length = bin.length;
	for (const image of json.images ?? []) {
		if (image.uri === undefined) continue;
		const bytes = readFileSync(join(dirname(file), decodeURIComponent(image.uri)));
		const gap = (4 - (length % 4)) % 4;
		parts.push(new Uint8Array(gap), bytes);
		length += gap;
		json.bufferViews = [
			...(json.bufferViews ?? []),
			{ buffer: 0, byteOffset: length, byteLength: bytes.length },
		];
		length += bytes.length;
		image.bufferView = json.bufferViews.length - 1;
		image.mimeType = 'image/ktx2';
		delete image.uri;
	}
	const merged = new Uint8Array(length);
	let at = 0;
	for (const part of parts) {
		merged.set(part, at);
		at += part.length;
	}
	const buffer = json.buffers?.[0];
	if (!buffer || buffer.uri !== undefined)
		throw new Error(`${file} has no binary chunk to pack into`);
	buffer.byteLength = length;
	return writeGlb(json, merged);
}

/** Each named node's triangles in a binary glTF file. */
function triangles(bytes: Uint8Array): [string, number][] {
	const { json } = readGlb(bytes);
	return (json.nodes ?? [])
		.filter((node) => node.mesh !== undefined)
		.map((node) => [
			node.name ?? '?',
			(json.meshes?.[node.mesh as number]?.primitives ?? []).reduce(
				(sum, p) => sum + (json.accessors?.[p.indices as number]?.count ?? 0) / 3,
				0,
			),
		]);
}

const out = process.argv[2];
if (!out) throw new Error('Give the output folder: bun tools/samples/blender/creek.ts <folder>');
const scratch = mkdtempSync(join(tmpdir(), 'creek-models-'));
try {
	const built = Bun.spawnSync(
		[
			BLENDER,
			'--background',
			'--factory-startup',
			'--python',
			join(import.meta.dir, 'creek.py'),
			'--',
			join(scratch, 'blender'),
		],
		{ stdout: 'pipe', stderr: 'pipe' },
	);
	if (built.exitCode !== 0) throw new Error(`Blender failed:\n${built.stdout}\n${built.stderr}`);
	mkdirSync(resolve(out), { recursive: true });
	for (const model of MODELS) {
		const optimized = join(scratch, 'optimized', model);
		// Cards and leaves let light through their cutouts, so only the cave hides what lies behind it.
		const code = await optimize([
			join(scratch, 'blender', `${model}.glb`),
			optimized,
			...(model === 'cave' ? [] : ['--no-blockers']),
		]);
		if (code !== 0) throw new Error(`The asset tool failed on ${model}.glb`);
		const packed = pack(join(optimized, `${model}.glb`));
		writeFileSync(join(resolve(out), `${model}.glb`), packed);
		const counts = triangles(packed)
			.map(([name, n]) => `${name} ${n}`)
			.join(', ');
		console.log(`${model}.glb: ${(packed.length / 1024).toFixed(0)} KB; triangles: ${counts}`);
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
