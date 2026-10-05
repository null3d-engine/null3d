// WebGPU errors after the start. The GPU path reports them outside any error scope, and the engine
// tells the page about the first of each kind, with E1305 for a command that the device rejected.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface ErrorsResult {
	tier: string;
	codes: string[];
	error?: string;
}

test('a command that the WebGPU device rejects reaches onFailure once, as E1305', async ({
	page,
}) => {
	await page.goto('gpu-errors.html?gpu=webgpu&render=main');
	const result = await pageResult<ErrorsResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.tier).toBe('webgpu');
	expect(result.codes).toEqual(['E1305']);
});
