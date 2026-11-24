// WebGPU errors after the start. The GPU path reports them outside any error scope, and the engine
// tells the page about the first of each kind, with E1305 for a command that the device rejected.
// A pipeline of the scene's objects that the GPU's driver refuses builds once more, and a second
// refusal reaches the page as E1307 while the engine draws on.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface ErrorsResult {
	tier: string;
	codes: string[];
	messages: string[];
	captured: boolean;
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

test('a pipeline that the GPU driver refuses twice reaches onFailure once, as E1307, and the engine draws on', async ({
	page,
}) => {
	await page.goto('gpu-errors.html?gpu=webgpu&render=main&refuse=always');
	const result = await pageResult<ErrorsResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.tier).toBe('webgpu');
	expect(result.codes).toEqual(['E1307']);
	expect(result.messages[0]).toContain('engine template mesh lit');
	expect(result.messages[0]).toContain('CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN');
	expect(result.captured).toBe(true);
});

test('a pipeline that the GPU driver refuses once builds again, and nothing is reported', async ({
	page,
}) => {
	await page.goto('gpu-errors.html?gpu=webgpu&render=main&refuse=once');
	const result = await pageResult<ErrorsResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.codes).toEqual([]);
	expect(result.captured).toBe(true);
});
