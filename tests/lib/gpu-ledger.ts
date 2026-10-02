// Counts the GPU objects that each thread of the engine holds, in Playwright's browser. Each thread
// wraps the calls that make and free GPU devices, WebGL2 contexts, textures, buffers, query sets and
// canvas setups, and posts what it holds after each call. A stopped worker's last post shows what it
// never freed: the browser frees that only when it collects the worker's objects, which Safari does
// late. The ledger frees an object only where Safari frees it at once, so Chrome's tests catch what
// Safari keeps.
import type { Page } from '@playwright/test';
import { prefixEngineScripts } from './engine-scripts.ts';

const CHANNEL = 'null3d-gpu-ledger';

/**
 * What one thread holds: devices, WebGL2 contexts, the textures, buffers and query sets that they
 * made, and the canvases that keep a display buffer larger than one pixel.
 */
export interface GpuHoldings {
	devices: number;
	contexts: number;
	textures: number;
	buffers: number;
	querySets: number;
	canvases: number;
}

/**
 * Runs once in each thread, before the engine's code. It follows Safari's rules:
 * - Destroying a device frees none of its textures, buffers and query sets. Each one stays until it
 *   is destroyed itself.
 * - Losing a WebGL2 context frees what it made. Renderbuffers count as textures.
 * - A canvas has display buffers of its size from a WebGPU context's configure or a WebGL2
 *   context's creation. Releasing the context keeps them, as `unconfigure` and a lost context do.
 *   Only a resize while the context holds the canvas replaces them, with buffers of the new size.
 * - The buffer on show stays until the canvas shows another frame. A WebGPU frame starts with
 *   `getCurrentTexture`, and a WebGL2 frame with a clear, draw or blit into the canvas.
 */
function installLedger(channelName: string): void {
	const installed = Symbol.for('null3d.test.gpuLedger');
	// The test files compile without the browser's types, so the browser's classes come by name.
	const thread = globalThis as unknown as Record<string | symbol, unknown>;
	if (thread[installed]) return;
	thread[installed] = true;
	type Type = { prototype: object } | undefined;
	const type = (typeName: string) => thread[typeName] as Type;
	const name = thread.document ? 'page' : (thread.name as string | undefined) || 'worker';
	const id = `${name} ${Math.random().toString(36).slice(2)}`;
	const channel = new BroadcastChannel(channelName);
	type Kind = 'textures' | 'buffers' | 'querySets';
	type Owner = { device: boolean; live: boolean } & Record<Kind, Set<object>>;
	const owners = new Map<object, Owner>();
	const ownerOf = new WeakMap<object, object>();
	type Sized = { width: number; height: number };
	/**
	 * Each canvas with display buffers: their pixels, the pixels of the buffer on show, and whether
	 * the context still holds the canvas.
	 */
	const canvases = new Map<Sized, { pixels: number; shown: number; live: boolean }>();
	const report = () => {
		const held = {
			id,
			devices: 0,
			contexts: 0,
			textures: 0,
			buffers: 0,
			querySets: 0,
			canvases: 0,
		};
		for (const owner of owners.values()) {
			if (owner.live && owner.device) held.devices++;
			else if (owner.live) held.contexts++;
			held.textures += owner.textures.size;
			held.buffers += owner.buffers.size;
			held.querySets += owner.querySets.size;
		}
		for (const canvas of canvases.values())
			if (Math.max(canvas.pixels, canvas.shown) > 1) held.canvases++;
		channel.postMessage(held);
	};
	const own = (owner: object, device: boolean) => {
		if (owners.has(owner)) return;
		const textures = new Set<object>();
		owners.set(owner, { device, live: true, textures, buffers: new Set(), querySets: new Set() });
		report();
	};
	const objects = (owner: Owner) => owner.textures.size + owner.buffers.size + owner.querySets.size;
	/** A device keeps what it made; a lost WebGL2 context frees it. */
	const release = (owner: object) => {
		const held = owners.get(owner);
		if (!held?.live) return;
		held.live = false;
		if (!held.device || objects(held) === 0) owners.delete(owner);
		report();
	};
	const made = (owner: object, kind: Kind, object: unknown) => {
		const held = owners.get(owner);
		if (!held?.live || !object) return;
		held[kind].add(object);
		ownerOf.set(object, owner);
		report();
	};
	const freed = (kind: Kind, object: unknown) => {
		const owner = object ? ownerOf.get(object) : undefined;
		const held = owner && owners.get(owner);
		if (!owner || !held?.[kind].delete(object as object)) return;
		if (!held.live && objects(held) === 0) owners.delete(owner);
		report();
	};
	/** The canvas's context holds it now, with display buffers of its size. */
	const hold = (canvas: Sized) => {
		const shown = canvases.get(canvas)?.shown ?? 0;
		canvases.set(canvas, { pixels: canvas.width * canvas.height, shown, live: true });
		report();
	};
	/** The canvas shows a frame of its size now. */
	const show = (canvas: Sized) => {
		const held = canvases.get(canvas);
		if (!held?.live || held.shown === canvas.width * canvas.height) return;
		held.shown = canvas.width * canvas.height;
		report();
	};
	/** The context lets the canvas go and keeps its display buffers. */
	const letGo = (canvas: Sized) => {
		const held = canvases.get(canvas);
		if (held) held.live = false;
	};
	const resized = (canvas: Sized) => {
		const held = canvases.get(canvas);
		if (!held?.live) return;
		held.pixels = canvas.width * canvas.height;
		report();
	};
	type Method = (this: object, ...args: unknown[]) => unknown;
	/** Wraps a method of a class, so `after` sees each call's object, result and arguments. */
	const wrap = (
		typeName: string,
		method: string,
		after: (self: object, result: unknown, args: unknown[]) => void,
	) => {
		const prototype = type(typeName)?.prototype as Record<string, Method> | undefined;
		const original = prototype?.[method];
		if (!prototype || !original) return;
		prototype[method] = function (this: object, ...args: unknown[]) {
			const result = original.apply(this, args);
			after(this, result, args);
			return result;
		};
	};

	type Device = { lost: Promise<unknown> };
	wrap('GPUAdapter', 'requestDevice', (_, result) => {
		void (result as Promise<Device>).then((device) => {
			own(device, true);
			void device.lost.then(() => release(device));
		});
	});
	wrap('GPUDevice', 'destroy', (device) => release(device));
	wrap('GPUDevice', 'createTexture', (device, texture) => made(device, 'textures', texture));
	wrap('GPUDevice', 'createBuffer', (device, buffer) => made(device, 'buffers', buffer));
	wrap('GPUDevice', 'createQuerySet', (device, set) => made(device, 'querySets', set));
	wrap('GPUTexture', 'destroy', (texture) => freed('textures', texture));
	wrap('GPUBuffer', 'destroy', (buffer) => freed('buffers', buffer));
	wrap('GPUQuerySet', 'destroy', (set) => freed('querySets', set));
	type CanvasContext = { canvas: Sized };
	wrap('GPUCanvasContext', 'configure', (context) => hold((context as CanvasContext).canvas));
	wrap('GPUCanvasContext', 'unconfigure', (context) => letGo((context as CanvasContext).canvas));
	wrap('GPUCanvasContext', 'getCurrentTexture', (context) =>
		show((context as CanvasContext).canvas),
	);

	type Context = { isContextLost(): boolean; canvas: Sized };
	type Canvas = Sized & { addEventListener(event: string, listener: () => void): void };
	const watched = new WeakSet<object>();
	for (const canvasType of ['HTMLCanvasElement', 'OffscreenCanvas']) {
		wrap(canvasType, 'getContext', (canvas, context, [kind]) => {
			if (kind !== 'webgl2' || !context || (context as Context).isContextLost()) return;
			if (owners.has(context)) return;
			own(context, false);
			hold(canvas as Canvas);
			if (watched.has(canvas)) return;
			watched.add(canvas);
			(canvas as Canvas).addEventListener('webglcontextlost', () => {
				release(context);
				letGo(canvas as Canvas);
			});
			(canvas as Canvas).addEventListener('webglcontextrestored', () => {
				own(context, false);
				hold(canvas as Canvas);
			});
		});
		const prototype = type(canvasType)?.prototype;
		for (const side of ['width', 'height']) {
			const property = prototype && Object.getOwnPropertyDescriptor(prototype, side);
			const set = property?.set;
			if (!prototype || !property || !set) continue;
			Object.defineProperty(prototype, side, {
				...property,
				set(this: Sized, value: number) {
					set.call(this, value);
					resized(this);
				},
			});
		}
	}
	const gl = 'WebGL2RenderingContext';
	/** The contexts that draw into a framebuffer of their own, not into the canvas. */
	const offCanvas = new WeakSet<object>();
	const FRAMEBUFFER = 0x8d40;
	const DRAW_FRAMEBUFFER = 0x8ca9;
	wrap(gl, 'bindFramebuffer', (context, _, [target, framebuffer]) => {
		if (target !== FRAMEBUFFER && target !== DRAW_FRAMEBUFFER) return;
		if (framebuffer) offCanvas.add(context);
		else offCanvas.delete(context);
	});
	for (const method of [
		'clear',
		'clearBufferfv',
		'drawArrays',
		'drawElements',
		'drawArraysInstanced',
		'drawElementsInstanced',
		'drawRangeElements',
		'blitFramebuffer',
	])
		wrap(gl, method, (context) => {
			if (!offCanvas.has(context)) show((context as Context).canvas);
		});
	wrap(gl, 'createTexture', (context, texture) => made(context, 'textures', texture));
	wrap(gl, 'createRenderbuffer', (context, buffer) => made(context, 'textures', buffer));
	wrap(gl, 'createBuffer', (context, buffer) => made(context, 'buffers', buffer));
	wrap(gl, 'deleteTexture', (_, __, [texture]) => freed('textures', texture));
	wrap(gl, 'deleteRenderbuffer', (_, __, [buffer]) => freed('textures', buffer));
	wrap(gl, 'deleteBuffer', (_, __, [buffer]) => freed('buffers', buffer));
	wrap(gl, 'getExtension', (context, extension, [extensionName]) => {
		if (extensionName !== 'WEBGL_lose_context' || !extension) return;
		const lose = extension as { loseContext(): void; [installed]?: true };
		if (lose[installed]) return;
		lose[installed] = true;
		const loseContext = lose.loseContext.bind(lose);
		lose.loseContext = () => {
			loseContext();
			release(context);
			letGo((context as Context).canvas);
		};
	});
}

/** Collects each thread's newest post on the page, as `window.__null3dGpuLedger`, by thread. */
function collectLedger(channelName: string): void {
	const ledger: Record<string, GpuHoldings> = {};
	(globalThis as { __null3dGpuLedger?: typeof ledger }).__null3dGpuLedger = ledger;
	new BroadcastChannel(channelName).onmessage = (event) => {
		const { id, ...held } = event.data as GpuHoldings & { id: string };
		ledger[id] = held;
	};
}

/**
 * Counts the GPU objects of every thread that the page's engine starts, from the next page load on.
 * Call `restoreEngineScripts` once the page's result is in.
 */
export async function watchGpuObjects(page: Page): Promise<void> {
	await page.addInitScript(collectLedger, CHANNEL);
	await prefixEngineScripts(page, `(${installLedger.toString()})(${JSON.stringify(CHANNEL)});`);
}

/** The threads that hold GPU objects now, by name, with what each holds. */
export function gpuObjectsHeld(page: Page): Promise<Record<string, GpuHoldings>> {
	return page.evaluate(() => {
		const ledger =
			(globalThis as { __null3dGpuLedger?: Record<string, GpuHoldings> }).__null3dGpuLedger ?? {};
		return Object.fromEntries(
			Object.entries(ledger).filter(([, held]) => Object.values(held).some((count) => count > 0)),
		);
	});
}
