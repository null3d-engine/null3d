// Builds a showcase scene's models for the sample-assets repository, from one of the Blender scripts
// beside this file to the files that the scene loads:
//
// 1. Blender runs the script headless, which writes one binary glTF file for each model.
// 2. The asset tool optimizes each one, as a project's build would: quantized meshes compressed
//    with meshopt, and KTX2 textures.
// 3. Each optimized model takes its KTX2 textures into its own binary chunk, so one file holds the
//    whole model. A page then loads it by its address alone, and a build copies one file.
//
// BLENDER names Blender's executable, which defaults to the one on the path.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { run as optimize } from '../../../packages/cli/src/assets/optimize.js';

/** The threads that Blender runs with in every build. */
const BLENDER_THREADS = 4;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

interface Gltf {
	images?: { uri?: string; bufferView?: number; mimeType?: string }[];
	bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
	buffers?: { byteLength: number; uri?: string }[];
	nodes?: { name?: string; mesh?: number }[];
	meshes?: { primitives: { indices?: number; attributes: Record<string, number> }[] }[];
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

/** Each named node's triangles in a binary glTF file, and whether its mesh carries the sway. */
function parts(bytes: Uint8Array): { name: string; triangles: number; sway: boolean }[] {
	const { json } = readGlb(bytes);
	return (json.nodes ?? [])
		.filter((node) => node.mesh !== undefined)
		.map((node) => {
			const primitives = json.meshes?.[node.mesh as number]?.primitives ?? [];
			return {
				name: node.name ?? '?',
				triangles: primitives.reduce(
					(sum, p) => sum + (json.accessors?.[p.indices as number]?.count ?? 0) / 3,
					0,
				),
				sway: primitives.every((p) => p.attributes.TEXCOORD_1 !== undefined),
			};
		});
}

/** What a scene's build makes. */
export interface SceneModels {
	/** The Blender script beside this file, such as `creek.py`. */
	readonly script: string;
	/** The models that the script writes, each as `<model>.glb`. */
	readonly models: readonly string[];
	/**
	 * The models that hide what lies behind them, such as rock. Leaves and cards let light through
	 * their cutouts, so the asset tool marks no occluders in the others.
	 */
	readonly blockers?: readonly string[];
	/** The models whose every part sways, which the build checks after the asset tool. */
	readonly swaying: readonly string[];
	/**
	 * Options that the script gets when the command line does not give them, such as the folder of
	 * a scene's inputs.
	 */
	readonly options?: Readonly<Record<string, string>>;
}

/**
 * The models that `--models <a,b>` on the command line picks from a scene's, in the scene's order,
 * or all of them. The script gets the option too, and may skip what it does not need.
 */
export function chosenModels(
	models: readonly string[],
	options = process.argv.slice(3),
): readonly string[] {
	const at = options.indexOf('--models');
	if (at < 0) return models;
	const picked = (options[at + 1] ?? '').split(',').filter((name) => name.length > 0);
	const unknown = picked.filter((name) => !models.includes(name));
	if (picked.length === 0 || unknown.length > 0)
		throw new Error(`--models takes a comma-separated list of ${models.join(', ')}`);
	return models.filter((model) => picked.includes(model));
}

/**
 * Runs a scene's Blender script and writes its optimized, packed models into the folder that the
 * command line names. The options after the folder go to the script: `--preview <folder>` renders
 * each model with Cycles there, `--models <a,b>` builds only those models, and a script that reads
 * inputs names its own, such as `--raw`.
 */
export async function buildScene({
	script,
	models,
	blockers = [],
	swaying,
	options = {},
}: SceneModels): Promise<void> {
	const args = process.argv.slice(2);
	const out = args[0];
	if (!out || out.startsWith('--'))
		throw new Error(
			`Give the output folder: bun tools/samples/blender/${script.replace('.py', '.ts')} <folder> [options]`,
		);
	const given = args.slice(1);
	const defaults = Object.entries(options).filter(([flag]) => !given.includes(flag));
	const chosen = chosenModels(models, given);
	const scratch = mkdtempSync(join(tmpdir(), `${script.replace('.py', '')}-models-`));
	try {
		const built = Bun.spawnSync(
			[
				process.env.BLENDER ?? 'blender',
				// Some meshes come out in an order that depends on Blender's thread count, so every
				// build runs with the same count and gives the same files on any machine.
				'--threads',
				String(BLENDER_THREADS),
				'--background',
				'--factory-startup',
				'--python',
				join(import.meta.dir, script),
				'--',
				join(scratch, 'blender'),
				...given,
				...defaults.flat(),
			],
			{ stdout: 'pipe', stderr: 'pipe' },
		);
		if (built.exitCode !== 0) throw new Error(`Blender failed:\n${built.stdout}\n${built.stderr}`);
		mkdirSync(resolve(out), { recursive: true });
		for (const model of chosen) {
			const optimized = join(scratch, 'optimized', model);
			const code = await optimize([
				join(scratch, 'blender', `${model}.glb`),
				optimized,
				...(blockers.includes(model) ? [] : ['--no-blockers']),
			]);
			if (code !== 0) throw new Error(`The asset tool failed on ${model}.glb`);
			const packed = pack(join(optimized, `${model}.glb`));
			const found = parts(packed);
			const still = found.filter((part) => !part.sway).map((part) => part.name);
			if (swaying.includes(model) && still.length > 0)
				throw new Error(`${model}.glb lost the sway coordinates of ${still.join(', ')}`);
			writeFileSync(join(resolve(out), `${model}.glb`), packed);
			const counts = found.map((part) => `${part.name} ${part.triangles}`).join(', ');
			console.log(`${model}.glb: ${(packed.length / 1024).toFixed(0)} KB; triangles: ${counts}`);
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
