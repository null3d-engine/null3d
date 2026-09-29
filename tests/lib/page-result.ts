// Reads what a test or benchmark page publishes on its window: the page's own result when it
// finishes, other values a page publishes, and the result of the engine's hold mode.
import type { JSHandle, Page } from '@playwright/test';

/** Waits until the page's window holds a value under `name`, and returns a handle to it. */
function waitForWindowValue(page: Page, name: string, timeoutMs: number): Promise<JSHandle> {
	return page.waitForFunction((key) => (globalThis as Record<string, unknown>)[key], name, {
		timeout: timeoutMs,
	});
}

/** Waits until the page's window holds a value under `name`, and returns it. */
export async function windowValue<T>(page: Page, name: string, timeoutMs: number): Promise<T> {
	return (await (await waitForWindowValue(page, name, timeoutMs)).jsonValue()) as T;
}

/** Waits until the page publishes its result, and returns it. Throws when the time runs out. */
export function pageResult<T>(page: Page, timeoutMs: number): Promise<T> {
	return windowValue<T>(page, '__null3dResult', timeoutMs);
}

/** Hold mode's result as a test reads it: the engine's own, with the pixels in base64. */
export type HoldReport =
	| {
			ok: true;
			time: number;
			frame: number;
			tier: string;
			width: number;
			height: number;
			pixels: string;
	  }
	| { ok: false; code: string | null; error: string };

/**
 * Waits until the engine publishes hold mode's result on the page, and returns it with the pixels
 * in base64. Throws when the time runs out.
 */
export async function holdResult(page: Page, timeoutMs: number): Promise<HoldReport> {
	const handle = await waitForWindowValue(page, '__null3dHold', timeoutMs);
	return handle.evaluate((result: Record<string, unknown>) => {
		if (!(result.pixels instanceof Uint8Array)) return result as HoldReport;
		const { pixels } = result;
		let binary = '';
		for (let i = 0; i < pixels.length; i += 0x8000)
			binary += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
		return { ...result, pixels: btoa(binary) } as HoldReport;
	});
}
