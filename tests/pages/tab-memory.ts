// Grows one kind of memory in steps until something gives, to find how much memory a tab can use:
// GPU textures or GPU buffers on the GPU path that ?gpu= names, or a shared WebAssembly memory, as
// ?kind= says. Each step allocates ?step= MiB in units of 16 MiB, fills every byte with data that
// does not compress, and waits until the GPU has taken it. After each step that lived, the page
// posts its progress to the dev server address that ?progress= names, so a tab that the browser
// closes still leaves its last step on record. Growth also ends when the browser refuses an
// allocation, takes the GPU away, or gives no answer to a step for a minute, or at ?most= MiB. The
// page then frees what it holds and publishes how far it got.
import { patientFetch } from '../lib/patient-fetch';
import { progress as note, run } from './lib/result';
import {
	type GrowthEnd,
	type GrowthProgress,
	type GrowthResult,
	readGrowthSwitches,
	UNIT_MIB,
} from './lib/tab-memory';

const MIB = 1024 * 1024;
/** The side of each texture: 2048 x 2048 RGBA8 texels make one unit. */
const SIDE = 2048;
/** WebAssembly memory comes in pages of 64 KiB. */
const WASM_PAGE = 64 * 1024;
/** The pause after each step, so the system can act on the last one before the next. */
const PAUSE_MS = 100;
/** How long a step may take before the page gives up on it. */
const STALL_MS = 60_000;

/** Something that grows: each call adds units, and says why it failed, or null when they live. */
interface Grower {
	grow(units: number): Promise<string | null>;
	/** Why the browser took the GPU away, or null while it has not. */
	lost(): string | null;
	release(): void;
}

/** One unit of data with no runs or repeats, so no memory compressor can shrink it. */
function noise(): Uint8Array {
	const words = new Uint32Array((UNIT_MIB * MIB) / 4);
	let x = 2463534242;
	for (let i = 0; i < words.length; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		words[i] = x >>> 0;
	}
	return new Uint8Array(words.buffer);
}

async function webgpuGrower(kind: 'texture' | 'buffer', data: Uint8Array): Promise<Grower> {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) throw new Error('no WebGPU adapter');
	const device = await adapter.requestDevice();
	let lostReason: string | null = null;
	void device.lost.then((info) => {
		lostReason = info.message || `the GPU device was lost (${info.reason})`;
	});
	const held: (GPUTexture | GPUBuffer)[] = [];
	return {
		async grow(units) {
			device.pushErrorScope('out-of-memory');
			device.pushErrorScope('validation');
			device.pushErrorScope('internal');
			for (let unit = 0; unit < units; unit++) {
				if (kind === 'texture') {
					const texture = device.createTexture({
						size: [SIDE, SIDE],
						format: 'rgba8unorm',
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
					});
					device.queue.writeTexture({ texture }, data, { bytesPerRow: SIDE * 4 }, [SIDE, SIDE]);
					held.push(texture);
				} else {
					const buffer = device.createBuffer({
						size: data.byteLength,
						usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
					});
					device.queue.writeBuffer(buffer, 0, data);
					held.push(buffer);
				}
			}
			await device.queue.onSubmittedWorkDone();
			const errors = await Promise.all([
				device.popErrorScope(),
				device.popErrorScope(),
				device.popErrorScope(),
			]);
			const error = errors.find((e) => e !== null);
			return error ? `WebGPU: ${error.message}` : null;
		},
		lost: () => lostReason,
		release() {
			for (const item of held) item.destroy();
			device.destroy();
		},
	};
}

function webgl2Grower(kind: 'texture' | 'buffer', data: Uint8Array): Grower {
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const gl = canvas.getContext('webgl2');
	if (!gl) throw new Error('no WebGL2 context');
	let lostReason: string | null = null;
	canvas.addEventListener('webglcontextlost', () => {
		lostReason = 'the WebGL2 context was lost';
	});
	const held: (WebGLTexture | WebGLBuffer)[] = [];
	const pixel = new Uint8Array(4);
	return {
		async grow(units) {
			for (let unit = 0; unit < units; unit++) {
				if (kind === 'texture') {
					const texture = gl.createTexture();
					gl.bindTexture(gl.TEXTURE_2D, texture);
					gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, SIDE, SIDE);
					gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SIDE, SIDE, gl.RGBA, gl.UNSIGNED_BYTE, data);
					held.push(texture);
				} else {
					const buffer = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
					gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
					held.push(buffer);
				}
			}
			// Reading a pixel waits until the GPU has run every command before it.
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
			const error = gl.getError();
			if (error === gl.NO_ERROR || error === gl.CONTEXT_LOST_WEBGL) return null;
			return error === gl.OUT_OF_MEMORY
				? 'WebGL2: OUT_OF_MEMORY'
				: `WebGL2: error 0x${error.toString(16)}`;
		},
		lost: () => lostReason ?? (gl.isContextLost() ? 'the WebGL2 context was lost' : null),
		release() {
			for (const item of held)
				if (kind === 'texture') gl.deleteTexture(item);
				else gl.deleteBuffer(item);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}

function wasmGrower(mostMiB: number, data: Uint8Array): Grower {
	const memory = new WebAssembly.Memory({
		initial: 0,
		maximum: (mostMiB * MIB) / WASM_PAGE,
		shared: true,
	});
	let size = 0;
	return {
		async grow(units) {
			try {
				memory.grow((units * data.byteLength) / WASM_PAGE);
			} catch (e) {
				return `WebAssembly: ${(e as Error).message}`;
			}
			for (let unit = 0; unit < units; unit++) {
				new Uint8Array(memory.buffer, size, data.byteLength).set(data);
				size += data.byteLength;
			}
			return null;
		},
		lost: () => null,
		release() {},
	};
}

/** Resolves with the step's answer, or with `stalled` when it gives none in time. */
function withDeadline(step: Promise<string | null>): Promise<string | null | 'stalled'> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<'stalled'>((resolve) => {
		timer = setTimeout(() => resolve('stalled'), STALL_MS);
	});
	return Promise.race([step, late]).finally(() => clearTimeout(timer));
}

/** Posts the progress so far where the dev server keeps it; a lost post never stops the growth. */
async function post(address: string | null, progress: GrowthProgress): Promise<void> {
	if (!address) return;
	try {
		const response = await patientFetch(address, {
			method: 'POST',
			body: JSON.stringify(progress),
		});
		if (!response.ok) note(`the dev server refused the progress: ${response.status}`);
	} catch (e) {
		note(`the progress did not reach the dev server: ${(e as Error).message}`);
	}
}

run('tab-memory', async () => {
	const switches = readGrowthSwitches(new URLSearchParams(location.search));
	const { kind, gpu, stepMiB, mostMiB } = switches;
	const data = noise();
	const grower =
		kind === 'wasm'
			? wasmGrower(mostMiB, data)
			: gpu === 'webgpu'
				? await webgpuGrower(kind, data)
				: webgl2Grower(kind, data);
	const progress: GrowthProgress = { kind, gpu, stepMiB, livedMiB: 0, steps: 0, elapsedMs: 0 };
	await post(switches.progress, progress);
	const started = performance.now();
	let end: GrowthEnd = 'cap';
	let reason: string | undefined;
	while (progress.livedMiB + stepMiB <= mostMiB) {
		note(`step ${progress.steps + 1}: ${progress.livedMiB + stepMiB} MiB`);
		const answer = await withDeadline(grower.grow(stepMiB / UNIT_MIB));
		const lost = grower.lost();
		if (answer === 'stalled' || lost !== null || answer !== null) {
			end = answer === 'stalled' ? 'stalled' : lost !== null ? 'lost' : 'refused';
			reason = answer === 'stalled' ? undefined : (lost ?? answer ?? undefined);
			break;
		}
		progress.livedMiB += stepMiB;
		progress.steps++;
		progress.elapsedMs = Math.round(performance.now() - started);
		await post(switches.progress, progress);
		await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
	}
	grower.release();
	const result: GrowthResult = { ...progress, end, mostMiB, ...(reason && { reason }) };
	return {
		...result,
		deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
	};
});
