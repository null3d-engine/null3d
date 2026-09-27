// The game worker: runs the game's code and the engine core. In pipelined mode it computes frame
// N+1 while the render worker draws frame N, and waits for the render worker's signal with
// Atomics.waitAsync, so its event loop stays alive for promises and messages. In low-latency mode it
// also owns the canvas and draws each frame itself.

import { GameRunner } from '../game/runner';
import { runDirectLoop } from '../render/direct-loop';
import { emptySceneInput } from '../render/loop';
import { createRenderer, type Renderer } from '../render/renderer';
import { controlViews, Slot } from '../shared/control';
import { startCore } from '../shared/core';
import type { GameWorkerMessage, WorkerReply } from './protocol';

let runner: GameRunner | undefined;
let renderer: Renderer | undefined;
let controlSlots: Int32Array | undefined;

const reply = (message: WorkerReply, transfer: Transferable[] = []) =>
	postMessage(message, { transfer });

/**
 * A promise that settles when the slot no longer holds `value`, or undefined when it already
 * holds another value. A plain function, so a wait makes no promise beyond the browser's own.
 */
function changeOf(slots: Int32Array, slot: Slot, value: number): Promise<unknown> | undefined {
	const wait = Atomics.waitAsync(slots, slot, value);
	return wait.async ? wait.value : undefined;
}

async function runPipelined(game: GameRunner, control: ArrayBufferLike): Promise<void> {
	const { slots } = controlViews(control);
	let published = 0;
	while (Atomics.load(slots, Slot.Running) !== 0) {
		const paused = Atomics.load(slots, Slot.Paused);
		if (paused !== 0) {
			const change = changeOf(slots, Slot.Paused, paused);
			if (change) await change;
			continue;
		}
		const taken = Atomics.load(slots, Slot.FramesTaken);
		if (taken < published) {
			const change = changeOf(slots, Slot.FramesTaken, taken);
			if (change) await change;
			continue;
		}
		published = game.step(performance.now());
		Atomics.store(slots, Slot.FramesPublished, published);
		Atomics.notify(slots, Slot.FramesPublished);
	}
}

self.onmessage = async (event: MessageEvent<GameWorkerMessage>) => {
	const message = event.data;
	if (message.type === 'init') {
		try {
			controlSlots = controlViews(message.control).slots;
			const started = await startCore(message.build, message.module, message.memory);
			const core = started.glue;
			const memory = started.memory as WebAssembly.Memory;
			runner = new GameRunner(
				(name, data, transfer) => reply({ type: 'game-message', name, data }, transfer),
				message.metrics,
				{ glue: core, memory, slots: controlSlots, jobWorkers: message.jobWorkers },
			);
			await runner.load(message.gameUrl);
			if (message.renderer) {
				renderer = await createRenderer(message.renderer.canvas, {
					...message.renderer,
					metrics: message.metrics,
					scene: { memory, control: message.control },
				});
				runDirectLoop(runner, renderer, message.control, message.metrics);
			} else {
				void runPipelined(runner, message.control);
			}
			reply({
				type: 'ready',
				role: 'game',
				threaded: core.isThreadedBuild(),
				version: core.engineVersion(),
				tier: renderer?.tier,
			});
		} catch (e) {
			reply({ type: 'error', role: 'game', message: e instanceof Error ? e.message : String(e) });
		}
	} else if (message.type === 'post') {
		runner?.receive(message.name, message.data);
	} else if (message.type === 'capture' && renderer && controlSlots) {
		const captured = await renderer.capture(
			emptySceneInput(Atomics.load(controlSlots, Slot.FramesTaken)),
		);
		reply({ type: 'captured', ...captured }, [captured.pixels.buffer]);
	}
};
