import { describe, expect, it } from 'bun:test';
import { EngineError } from '../errors/engine-error';
import { FirstFrame } from './first-frame';

describe('FirstFrame', () => {
	it('resolves once the GPU has finished the first frame, and a later stop changes nothing', async () => {
		const first = new FirstFrame();
		first.drawn();
		first.stopped(false, new EngineError('E1404', 'the render worker failed.'));
		await expect(first.promise).resolves.toBeUndefined();
	});

	it('rejects with the failure that ended the frames before the first one', async () => {
		const first = new FirstFrame();
		const failure = new EngineError('E1404', 'the render worker failed: Unable to create texture.');
		first.stopped(false, failure);
		first.drawn();
		await expect(first.promise).rejects.toBe(failure);
	});

	it('rejects with E1420 when the page stops the engine before its first frame', async () => {
		const first = new FirstFrame();
		first.stopped(false);
		const error = await first.promise.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(EngineError);
		expect((error as EngineError).code).toBe('E1420');
	});

	it('resolves at a stop once the GPU has finished the first frame, before the page saw it', async () => {
		const first = new FirstFrame();
		first.stopped(true);
		await expect(first.promise).resolves.toBeUndefined();
	});

	it('leaves no unhandled rejection when nothing waits for the first frame', async () => {
		const unhandled: unknown[] = [];
		const listen = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', listen);
		try {
			new FirstFrame().stopped(false);
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(unhandled).toEqual([]);
		} finally {
			process.off('unhandledRejection', listen);
		}
	});
});
