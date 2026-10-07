// Compiles the engine core once, overlapping the download, and creates the shared memory that every
// thread of the threaded build uses. Workers receive the compiled module, so the browser compiles it
// only once.

import { EngineError } from '../errors/engine-error';
import { QUALITY_SETTINGS } from '../quality/presets';
import { type Build, coreUrls } from '../shared/core';
import { compileWasm, type MemoryLimits, readMemoryLimits, type WasmError } from '../shared/wasm';
import { endParkedWorkers } from './ownership';

/**
 * The shared memory's maximum when neither the page nor a quality preset asks for one: 1 GiB. The
 * browser reserves address space for the whole maximum when the engine starts, and the page's
 * other engines and WebAssembly modules share what is left. An iPad holds 6 memories with this
 * maximum and 3 with 4 GiB, and scenes need far less than 1 GiB today (D-04). Every preset asks
 * for it until measurements of the memory that tabs can use set a maximum per preset.
 */
export const DEFAULT_MAXIMUM_MIB = 1024;
/** The smallest maximum a page can ask for, as the preset table's memory setting takes it. */
export const MIN_MAXIMUM_MIB = QUALITY_SETTINGS.memoryMaximumMiB.values.min;
/** The largest maximum a page can ask for: the 4 GiB that the threaded core declares. */
export const MAX_MAXIMUM_MIB = QUALITY_SETTINGS.memoryMaximumMiB.values.max;
/** WebAssembly memory comes in pages of 64 KiB, 16 to a MiB. */
const PAGES_PER_MIB = 16;
/**
 * How long to wait before each further try to create the shared memory, in ms: the waits double
 * from 50 ms up to 8 s, for about 45 s in all. Safari on a slow Mac gave back the memory that
 * removed frames held 16 to 40 s later (D-94).
 */
export const MEMORY_RETRY_MS: readonly number[] = [
	50, 100, 200, 400, 800, 1600, 3200, 6400, 8000, 8000, 8000, 8000,
];
/** How long the tries wait, in ms, before the page hears that the engine still waits for memory. */
export const MEMORY_WAIT_NOTICE_MS = 10_000;
/** The whole wait of the tries, in whole seconds, as the error that ends them gives it. */
const RETRY_SECONDS = Math.round(MEMORY_RETRY_MS.reduce((sum, ms) => sum + ms, 0) / 1000);

export interface LoadedCore {
	build: Build;
	module: WebAssembly.Module;
	memory?: WebAssembly.Memory;
}

const coreError: WasmError = (code, message) => new EngineError(code, message);

/** The slot where the page's early script leaves the core's response (page/early-core.ts). */
export const EARLY_CORE_SLOT = Symbol.for('null3d.early-core');

interface EarlyCore {
	url: string;
	response: Promise<Response>;
}

/**
 * The core's response that the page's early script started, when it is for `url`. The loader takes
 * it once, so a later start downloads afresh, as its response is already read.
 */
export function takeEarlyCore(url: URL): Promise<Response> | undefined {
	const slots = globalThis as Record<symbol, EarlyCore | undefined>;
	const early = slots[EARLY_CORE_SLOT];
	if (early?.url !== url.href) return undefined;
	delete slots[EARLY_CORE_SLOT];
	return early.response;
}

/**
 * The shared memory's maximum in MiB: the `?memory=` switch's, which wins, then the page's
 * `memory.maximumMiB` option's, then `fallback`, the quality preset's. An option that is not a
 * whole number of MiB within the range a page can ask for fails with E1409, even when the switch
 * wins.
 */
export function memoryMaximumMiB(
	option: number | undefined,
	fromSwitch: number | undefined,
	fallback = DEFAULT_MAXIMUM_MIB,
): number {
	if (
		option !== undefined &&
		!(Number.isInteger(option) && option >= MIN_MAXIMUM_MIB && option <= MAX_MAXIMUM_MIB)
	)
		throw new EngineError(
			'E1409',
			`the memory.maximumMiB option ${String(option)} is not a whole number of MiB from ${MIN_MAXIMUM_MIB} to ${MAX_MAXIMUM_MIB}.`,
		);
	return fromSwitch ?? option ?? fallback;
}

/**
 * The shared memory's declared maximum in pages: `maximumMiB`, within the maximum that the core
 * module declares, and never below the memory's initial size.
 */
export function maximumPages(limits: MemoryLimits, maximumMiB: number): number {
	const wanted = maximumMiB * PAGES_PER_MIB;
	return Math.max(limits.initial, Math.min(limits.maximum ?? wanted, wanted));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Creates the shared memory, trying again while the browser refuses it. A browser refuses a new
 * shared memory when the address space it keeps for them, or its budget of their pages, is full.
 * A stopped engine's memory counts against both until the engine's workers have finished, which
 * Safari does a moment after the engine stops. So after each refusal the loader waits longer and
 * tries again, for about 45 seconds in all, and a refusal after that fails with E1109. The first
 * refusal after 10 seconds of waits also tells the page, through `stillWaiting`. The first refusal also ends
 * the drawing workers that stopped engines left with their canvases: Safari frees the memory that
 * such a worker used only once the worker ends. `create`, `pause` and `freeRoom` stand in for the
 * browser and the page in tests.
 */
export async function createSharedMemory(
	descriptor: WebAssembly.MemoryDescriptor,
	create: (descriptor: WebAssembly.MemoryDescriptor) => WebAssembly.Memory = (d) =>
		new WebAssembly.Memory(d),
	pause: (ms: number) => Promise<void> = wait,
	freeRoom: () => void = () =>
		endParkedWorkers('when the browser refused the shared memory of a new engine'),
	stillWaiting: () => void = () => {},
): Promise<WebAssembly.Memory> {
	let waited = 0;
	let told = false;
	for (let tries = 1; ; tries++) {
		try {
			return create(descriptor);
		} catch (e) {
			if (tries === 1) freeRoom();
			if (!told && waited >= MEMORY_WAIT_NOTICE_MS) {
				told = true;
				stillWaiting();
			}
			const delay = MEMORY_RETRY_MS[tries - 1];
			if (delay === undefined) {
				const mib = Math.ceil((descriptor.maximum ?? descriptor.initial) / PAGES_PER_MIB);
				throw new EngineError(
					'E1109',
					`the browser refused the engine's shared memory of ${mib} MiB ${tries} times over ${RETRY_SECONDS} seconds: ${(e as Error).message}.`,
				);
			}
			waited += delay;
			await pause(delay);
		}
	}
}

/**
 * Downloads and compiles a core build. For the threaded build it also creates the shared memory,
 * with the initial size and the maximum that the module's import declares, which the loader reads
 * from the start of the download while the browser compiles the rest. The limits need no file of
 * their own, so a strict Content-Security-Policy has no inline address to block. `memoryWait` hears
 * when the browser has refused the memory for 10 seconds and the loader still tries.
 */
export async function loadCore(
	build: Build,
	maximumMiB = DEFAULT_MAXIMUM_MIB,
	memoryWait?: () => void,
): Promise<LoadedCore> {
	const threaded = build === 'threaded';
	const url = coreUrls(build).wasm;
	const { module, head: limits } = await compileWasm(
		url,
		`the ${build} engine core`,
		coreError,
		threaded ? readMemoryLimits : undefined,
		takeEarlyCore(url),
	);
	if (!threaded) return { build, module };
	if (!limits)
		throw new EngineError(
			'E1402',
			'the threaded engine core imports no shared memory, so it comes from another build.',
		);
	const maximum = maximumPages(limits, maximumMiB);
	return {
		build,
		module,
		memory: await createSharedMemory(
			{ initial: limits.initial, maximum, shared: true },
			undefined,
			undefined,
			undefined,
			memoryWait,
		),
	};
}
