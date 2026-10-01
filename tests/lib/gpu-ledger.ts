// Counts the GPU objects that each thread of the engine holds, in Playwright's browser. Each thread
// wraps the calls that make and free GPU devices, WebGL2 contexts, textures and buffers, and posts
// what it holds after each call. A stopped worker's last post shows what it never freed: the browser
// frees that only when it collects the worker's objects, which Safari does late.
import type { Page } from '@playwright/test';
import { prefixEngineScripts } from './engine-scripts.ts';

const CHANNEL = 'null3d-gpu-ledger';

/** What one thread holds: devices, WebGL2 contexts, and the textures and buffers that they made. */
export interface GpuHoldings {
	devices: number;
	contexts: number;
	textures: number;
	buffers: number;
}

/**
 * Runs once in each thread, before the engine's code. A device or a context frees what it made when
 * it is destroyed or lost. Renderbuffers count as textures.
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
	type Kind = 'textures' | 'buffers';
	type Owner = { device: boolean } & Record<Kind, Set<object>>;
	const owners = new Map<object, Owner>();
	const ownerOf = new WeakMap<object, object>();
	const report = () => {
		const held = { id, devices: 0, contexts: 0, textures: 0, buffers: 0 };
		for (const owner of owners.values()) {
			if (owner.device) held.devices++;
			else held.contexts++;
			held.textures += owner.textures.size;
			held.buffers += owner.buffers.size;
		}
		channel.postMessage(held);
	};
	const own = (owner: object, device: boolean) => {
		if (owners.has(owner)) return;
		owners.set(owner, { device, textures: new Set(), buffers: new Set() });
		report();
	};
	const release = (owner: object) => {
		if (owners.delete(owner)) report();
	};
	const made = (owner: object, kind: Kind, object: unknown) => {
		const held = owners.get(owner);
		if (!held || !object) return;
		held[kind].add(object);
		ownerOf.set(object, owner);
		report();
	};
	const freed = (kind: Kind, object: unknown) => {
		const owner = object && ownerOf.get(object);
		if (owner && owners.get(owner)?.[kind].delete(object as object)) report();
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
	wrap('GPUTexture', 'destroy', (texture) => freed('textures', texture));
	wrap('GPUBuffer', 'destroy', (buffer) => freed('buffers', buffer));

	type Context = { isContextLost(): boolean };
	type Canvas = { addEventListener(event: string, listener: () => void): void };
	for (const canvasType of ['HTMLCanvasElement', 'OffscreenCanvas'])
		wrap(canvasType, 'getContext', (canvas, context, [kind]) => {
			if (kind !== 'webgl2' || !context || (context as Context).isContextLost()) return;
			own(context, false);
			(canvas as Canvas).addEventListener('webglcontextlost', () => release(context));
		});
	const gl = 'WebGL2RenderingContext';
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
