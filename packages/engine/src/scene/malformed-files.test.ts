// Malformed glTF and KTX2 files, made from good ones: cut short at many lengths, with random bytes
// changed, and, for glTF, with one value of the JSON of the wrong kind or range, or left out. The
// parsers must either read each file or refuse it with their own error, which names what is wrong,
// and quickly. Any other error, such as a TypeError or a RangeError from a read past the end, is a
// fault. A seeded random generator picks the changes, so each run makes the same files, and a
// failure names the change that broke the parser.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shippedDecoder } from '../../../../tests/lib/meshopt-checks';
import { armBuilder, type GltfJson, morphBuilder } from '../../../../tests/pages/lib/gltf-files';
import { serveTasks, type TaskAnswer, type TaskRequest, type TaskSource } from '../workers/tasks';
import { GltfError, type MeshoptDecode, parseGltf, readContainer } from './gltf-parse';
import { Ktx2Refusal, readKtx2Header, transcodedBytes } from './ktx2';

const ASSETS = join(import.meta.dir, '../../../../tests/pages/assets');
const VENDOR = join(import.meta.dir, '../../vendor/basis');
const URL_OF = 'https://example.com/models/malformed.glb';

/** How long one malformed file may take to parse or fail, in milliseconds. */
const QUICK_MS = 1500;
/** The malformed copies of each file for each kind of change. */
const CASES = 500;

/** A small seeded generator of whole numbers below `n` (mulberry32). */
function seeded(seed: number): (n: number) => number {
	let state = seed >>> 0;
	return (n) => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
	};
}

/** `count` lengths from 0 to the file's length, every one for a small file, evenly spread otherwise. */
function cutLengths(length: number, count = CASES): number[] {
	if (length <= count) return Array.from({ length }, (_, k) => k);
	return Array.from({ length: count }, (_, k) => Math.floor((k * length) / count));
}

/** A copy of `bytes` with 1 to 4 bytes from `from` on set to random values. */
function withRandomBytes(bytes: Uint8Array, random: (n: number) => number, from = 0): Uint8Array {
	const copy = bytes.slice();
	const changes = 1 + random(4);
	for (let k = 0; k < changes; k++) copy[from + random(bytes.length - from)] = random(256);
	return copy;
}

/** A GLB file's JSON and binary chunk. */
function splitGlb(file: Uint8Array): { json: GltfJson; bin: Uint8Array; binAt: number } {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const jsonLength = view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + jsonLength)));
	const binAt = 20 + jsonLength + 8;
	return { json, bin: file.subarray(binAt, binAt + view.getUint32(20 + jsonLength, true)), binAt };
}

/** A GLB file of `json` and `bin`. */
function joinGlb(json: GltfJson, bin: Uint8Array): Uint8Array {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const jsonLength = Math.ceil(text.length / 4) * 4;
	const total = 28 + jsonLength + bin.length;
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, total, true);
	view.setUint32(12, jsonLength, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.fill(0x20, 20, 20 + jsonLength);
	out.set(text, 20);
	view.setUint32(20 + jsonLength, bin.length, true);
	view.setUint32(24 + jsonLength, 0x004e4942, true);
	out.set(bin, 28 + jsonLength);
	return out;
}

/** The path of every value in `value` below its top, which a JSON change can replace. */
function valuePaths(value: unknown, path: (string | number)[] = []): (string | number)[][] {
	const here = path.length > 0 ? [path] : [];
	if (Array.isArray(value))
		return [...here, ...value.flatMap((item, k) => valuePaths(item, [...path, k]))];
	if (value && typeof value === 'object')
		return [
			...here,
			...Object.entries(value).flatMap(([key, item]) => valuePaths(item, [...path, key])),
		];
	return here;
}

/**
 * Values of the wrong range or kind for glTF's JSON: indices and counts past every array, below
 * zero, not whole and past 32 bits, values of other types, and no value at all, which leaves the
 * field out.
 */
const WRONG_VALUES: readonly unknown[] = [
	undefined,
	-1,
	0,
	1.5,
	255,
	65_535,
	2 ** 31,
	2 ** 32 + 3,
	Number.MAX_SAFE_INTEGER,
	1e300,
	null,
	'1',
	'constructor',
	'__proto__',
	true,
	[],
	[-1],
	{},
];

/** A copy of `json` with the value at `path` replaced, or left out where `value` is undefined. */
function withValue(json: GltfJson, path: readonly (string | number)[], value: unknown): GltfJson {
	const copy = structuredClone(json);
	let at: GltfJson = copy;
	for (const key of path.slice(0, -1)) at = at[key];
	const last = path[path.length - 1] as string | number;
	const list = Array.isArray(at);
	if (value === undefined && !list) delete at[last];
	else at[last] = value;
	return copy;
}

/**
 * Parses `file`, and returns how it ended: 'read', or the refusal's code. Throws when the parser
 * fails with any error but its own, or takes too long. `change` names the change in the message.
 */
function parseOutcome(file: Uint8Array, change: string, decode?: MeshoptDecode): string {
	const start = performance.now();
	let outcome: string;
	try {
		parseGltf(readContainer(file, URL_OF), new Map(), URL_OF, decode);
		outcome = 'read';
	} catch (error) {
		if (!(error instanceof GltfError))
			throw new Error(`${change}: the parser failed with ${String(error)}`);
		outcome = error.code;
	}
	const took = performance.now() - start;
	if (took > QUICK_MS) throw new Error(`${change}: the parser took ${took.toFixed(0)} ms`);
	return outcome;
}

/** The glTF files that the changes start from, each with the extensions its parse needs. */
const GLTF_FILES: readonly { name: string; file: () => Uint8Array; meshopt?: boolean }[] = [
	{ name: 'the asset scene', file: () => readFileSync(join(ASSETS, 'models/asset-scene.glb')) },
	{
		name: 'the optimized asset scene, with meshopt data and KTX2 textures',
		file: () => readFileSync(join(ASSETS, 'models/optimized/asset-scene.glb')),
		meshopt: true,
	},
	{
		name: 'the meshopt instancing file',
		file: () => readFileSync(join(ASSETS, 'models/simple-instancing-meshopt.glb')),
		meshopt: true,
	},
	{ name: 'a skinned arm with its clips', file: () => armBuilder().glb() },
	{ name: 'a mesh with morph targets', file: () => morphBuilder().glb() },
];

describe('malformed glTF files', () => {
	for (const { name, file, meshopt } of GLTF_FILES) {
		const original = new Uint8Array(file());
		const decoder = meshopt ? shippedDecoder() : Promise.resolve(undefined);

		test(`${name} parses as it is`, async () => {
			expect(parseOutcome(original, 'the file as it is', await decoder)).toBe('read');
		});

		test(`${name}, cut short at ${CASES} lengths, is refused with a reason`, async () => {
			const decode = await decoder;
			for (const length of cutLengths(original.length))
				expect(
					parseOutcome(original.subarray(0, length), `cut to ${length} bytes`, decode),
				).not.toBe('read');
		});

		test(`${name}, with random bytes changed, parses or is refused with a reason`, async () => {
			const decode = await decoder;
			const random = seeded(original.length);
			const { binAt } = splitGlb(original);
			for (let k = 0; k < CASES; k++) {
				// Half the changes fall in the binary chunk, where the JSON still parses.
				const changed = withRandomBytes(original, random, k % 2 === 0 ? binAt : 0);
				parseOutcome(changed, `change ${k} of the random bytes`, decode);
			}
		});

		test(`${name}, with a value of its JSON of the wrong kind or range, or left out, parses or is refused with a reason`, async () => {
			const decode = await decoder;
			const { json, bin } = splitGlb(original);
			const paths = valuePaths(json);
			const random = seeded(paths.length);
			for (let k = 0; k < CASES; k++) {
				const path = paths[random(paths.length)] as (string | number)[];
				const value = WRONG_VALUES[random(WRONG_VALUES.length)];
				const change = `${path.join('.')} set to ${JSON.stringify(value)}`;
				parseOutcome(joinGlb(withValue(json, path, value), bin), change, decode);
			}
		});
	}
});

/** The test page's KTX2 files and the asset tool's, one of each codec and one with alpha. */
const KTX2_FILES = [
	'textures/quarters-etc1s.ktx2',
	'textures/quarters-uastc.ktx2',
	'textures/quarters-hdr.ktx2',
	'textures/budget-checker-etc1s.ktx2',
	'models/optimized/textures/b09b0d5ff9923cbe.ktx2',
];

/** How reading a KTX2 file's header ended: the header, or the refusal. Throws on any other error. */
function headerOutcome(file: Uint8Array, change: string): ReturnType<typeof readKtx2Header> | null {
	try {
		return readKtx2Header(file);
	} catch (error) {
		if (error instanceof Ktx2Refusal) return null;
		throw new Error(`${change}: the header reader failed with ${String(error)}`);
	}
}

describe('malformed KTX2 files', () => {
	for (const path of KTX2_FILES) {
		const original = new Uint8Array(readFileSync(join(ASSETS, path)));

		test(`${path}, cut short or with random bytes changed, is read or refused with a reason`, () => {
			for (const length of cutLengths(original.length, original.length))
				headerOutcome(original.subarray(0, length), `cut to ${length} bytes`);
			const random = seeded(original.length);
			for (let k = 0; k < CASES; k++)
				headerOutcome(withRandomBytes(original, random), `change ${k} of the random bytes`);
		});
	}

	test('the transcoder writes what the header promises or fails, and still works after each failure', async () => {
		const module = await WebAssembly.compile(readFileSync(join(VENDOR, 'basis_transcoder.wasm')));
		const answers: TaskAnswer[] = [];
		const source: TaskSource = { onmessage: null, postMessage: (answer) => answers.push(answer) };
		const tasks = serveTasks(source);
		let id = 0;
		/** Transcodes `file` to RGBA8 as the loader asks, and returns the task's answer. */
		const transcode = async (file: Uint8Array): Promise<TaskAnswer | undefined> => {
			const header = readKtx2Header(file);
			const format = header.codec === 'uastc-hdr' ? 'cTFRGB_9E5' : 'cTFRGBA32';
			const request: TaskRequest = {
				id: ++id,
				task: 'ktx2',
				...(id === 1 && { modules: [['basis', module]] }),
				input: { file: file.slice().buffer, format, levels: header.levels, layers: header.layers },
			};
			source.onmessage?.(new MessageEvent('message', { data: request }));
			await tasks.whenIdle(() => answers.some((answer) => answer.id === request.id));
			return answers.find((answer) => answer.id === request.id);
		};
		const good = new Uint8Array(readFileSync(join(ASSETS, 'textures/quarters-uastc.ktx2')));
		const goodBytes = transcodedBytes('rgba8unorm', 64, 64, readKtx2Header(good).levels, 1);
		const outputBytes = (answer: TaskAnswer | undefined) =>
			(answer as { output?: ArrayBuffer }).output?.byteLength;
		expect(outputBytes(await transcode(good))).toBe(goodBytes);
		let failed = 0;
		for (const path of KTX2_FILES) {
			const original = new Uint8Array(readFileSync(join(ASSETS, path)));
			const random = seeded(original.length + 1);
			for (let k = 0; k < CASES / 4; k++) {
				const changed = withRandomBytes(original, random, 48);
				const header = headerOutcome(changed, `change ${k} of ${path}`);
				if (!header) continue;
				const answer = await transcode(changed);
				if ('failed' in (answer ?? {})) {
					failed++;
					expect((answer as { failed: { stage: string } }).failed.stage).toBe('run');
				} else {
					const format = header.codec === 'uastc-hdr' ? 'rgb9e5ufloat' : 'rgba8unorm';
					const promised = transcodedBytes(
						format,
						header.width,
						header.height,
						header.levels,
						header.layers,
					);
					expect(outputBytes(answer), `change ${k} of ${path}`).toBe(promised);
				}
				expect(outputBytes(await transcode(good)), `after change ${k} of ${path}`).toBe(goodBytes);
			}
		}
		// Some changes must reach the transcoder and fail there, or the test proves nothing.
		expect(failed).toBeGreaterThan(0);
	});
});
