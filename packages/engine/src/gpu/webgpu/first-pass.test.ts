import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { FirstPass } from './first-pass';

const scope = globalThis as { GPUTextureUsage?: unknown };
beforeAll(() => {
	scope.GPUTextureUsage = { RENDER_ATTACHMENT: 16 };
});
afterAll(() => {
	delete scope.GPUTextureUsage;
});

/** A device whose pipeline builds when `build` settles, and which records the pass's calls. */
function fakeDevice(build: Promise<unknown>) {
	const calls: string[] = [];
	const device = {
		createShaderModule: () => ({}),
		createRenderPipelineAsync: () => build,
		createTexture: () => ({
			createView: () => ({}),
			destroy: () => calls.push('destroy target'),
		}),
		createCommandEncoder: () => ({
			beginRenderPass: () => ({
				setPipeline: () => calls.push('set pipeline'),
				draw: (count: number) => calls.push(`draw ${count}`),
				end: () => calls.push('end'),
			}),
			finish: () => ({}),
		}),
		queue: { submit: () => calls.push('submit') },
	};
	return { device: device as unknown as GPUDevice, calls };
}

describe('the first pass on a device', () => {
	it('holds frames until its pipeline is built, then draws one point once', async () => {
		let built: (pipeline: unknown) => void = () => {};
		const { device, calls } = fakeDevice(new Promise((resolve) => (built = resolve)));
		const pass = new FirstPass(device);
		expect(pass.ready).toBe(false);
		pass.draw();
		expect(calls).toEqual([]);
		built({});
		await pass.built;
		expect(pass.ready).toBe(true);
		pass.draw();
		pass.draw();
		expect(calls).toEqual(['set pipeline', 'draw 1', 'end', 'submit', 'destroy target']);
		expect(pass.ready).toBe(true);
	});

	it('holds no frame when its pipeline fails to build, as on a lost device', async () => {
		const { device, calls } = fakeDevice(Promise.reject(new Error('lost')));
		const pass = new FirstPass(device);
		await pass.built;
		expect(pass.ready).toBe(true);
		pass.draw();
		expect(calls).toEqual([]);
	});

	it("is drawn by the scene renderer before each device's first frame and capture", () => {
		const source = readFileSync(
			new URL('../../render/webgpu-renderers.ts', import.meta.url),
			'utf8',
		);
		expect(source).toContain('this.firstPass = new FirstPass(device);');
		expect(source).toContain('return this.frames.prepare(frame) && this.firstPass.ready;');
		expect(source).toMatch(/this\.firstPass\.draw\(\);\s*this\.frames\.replay\(input\.frame\);/);
		expect(source).toMatch(
			/await this\.firstPass\.built;\s*this\.firstPass\.draw\(\);[\s\S]*?this\.frames\.replay\(frame\);/,
		);
	});
});
