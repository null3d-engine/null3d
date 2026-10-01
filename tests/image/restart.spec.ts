import { type CDPSession, expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { prefixEngineScripts, restoreEngineScripts } from '../lib/engine-scripts.ts';
import { pageResult } from '../lib/page-result.ts';
import type { RestartResult } from '../lib/plans.ts';

/** How many times each test starts and stops the engine on one page. */
const CYCLES = 3;

/** How many objects the page can still reach whose prototype chain holds `prototype`. */
async function reachable(cdp: CDPSession, prototype: string): Promise<number> {
	const { result } = await cdp.send('Runtime.evaluate', { expression: prototype });
	const { objects } = await cdp.send('Runtime.queryObjects', {
		prototypeObjectId: result.objectId as string,
	});
	const count = await cdp.send('Runtime.callFunctionOn', {
		objectId: objects.objectId as string,
		functionDeclaration: 'function () { return this.length; }',
		returnByValue: true,
	});
	return count.result.value as number;
}

// A page starts the engine again after it stops it, and after a collection it reaches none of a
// stopped engine's memory, except the single-threaded build's core, which the page keeps for the
// next engine.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`the engine starts again after it stops, and lets go of its memory, ${mode.name} on ${gpu}`, async ({
			page,
		}) => {
			await page.goto(`shared-memory.html?room=off&cycles=${CYCLES}&gpu=${gpu}&${mode.query}`);
			const result = await pageResult<RestartResult & { error?: string }>(page, 60_000);
			expect(result.error).toBeUndefined();
			expect(result.kinds.engine?.error).toBeUndefined();
			expect(result.kinds.engine?.cycles).toBe(CYCLES);
			const cdp = await page.context().newCDPSession(page);
			await cdp.send('HeapProfiler.collectGarbage');
			const kept = mode.build === 'single' ? 1 : 0;
			expect(await reachable(cdp, 'WebAssembly.Memory.prototype')).toBe(kept);
			expect(await reachable(cdp, 'Worker.prototype')).toBe(0);
		});
	}
}

/**
 * Makes each GPU texture fail as the iPad's did once its GPU memory ran out, in every thread, so
 * the thread that draws fails at its first frame, while the engine starts.
 */
const TEXTURES_FAIL = `if (typeof GPUDevice !== 'undefined') GPUDevice.prototype.createTexture = () => {
	throw new DOMException('GPUDevice.createTexture: Unable to create texture.', 'InvalidStateError');
};`;

// When the thread that draws fails while the engine starts, the start fails with that error instead
// of waiting for frames that never come. The engine has stopped by then, so after a collection the
// page reaches none of its memory and none of its workers.
for (const mode of ENGINE_MODES) {
	test(`a start whose drawing fails rejects, and lets go of its memory, ${mode.name}`, async ({
		page,
	}) => {
		await prefixEngineScripts(page, TEXTURES_FAIL);
		await page.goto(`shared-memory.html?room=off&cycles=1&gpu=webgpu&${mode.query}`);
		const result = await pageResult<RestartResult & { error?: string }>(page, 60_000);
		await restoreEngineScripts(page);
		const engine = result.kinds.engine;
		expect(engine?.error).toMatch(/^E140[45]: .*Unable to create texture/);
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('HeapProfiler.collectGarbage');
		const kept = mode.build === 'single' ? 1 : 0;
		expect(await reachable(cdp, 'WebAssembly.Memory.prototype')).toBe(kept);
		expect(await reachable(cdp, 'Worker.prototype')).toBe(0);
	});
}
