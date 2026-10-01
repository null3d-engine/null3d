import { type CDPSession, expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { restoreEngineScripts } from '../lib/engine-scripts.ts';
import { gpuObjectsHeld, watchGpuObjects } from '../lib/gpu-ledger.ts';
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
// next engine. Each stop destroys every GPU object that the engine made, with its device or its
// WebGL2 context, on whichever thread drew: a browser frees what a stopped worker still holds only
// when it collects the worker's objects. The count of GPU objects is exact, so a few starts show an
// object that any start leaves behind.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`the engine starts again after it stops, and lets go of its memory and its GPU objects, ${mode.name} on ${gpu}`, async ({
			page,
		}) => {
			await watchGpuObjects(page);
			await page.goto(`shared-memory.html?room=off&cycles=${CYCLES}&gpu=${gpu}&${mode.query}`);
			const result = await pageResult<RestartResult & { error?: string }>(page, 60_000);
			await restoreEngineScripts(page);
			await expect.poll(() => gpuObjectsHeld(page)).toEqual({});
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
