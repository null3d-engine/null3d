import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageRun } from '../tests/lib/images.ts';
import {
	pictureSize,
	readOptions,
	resolveShot,
	type Shot,
	shotDigest,
	webpBytes,
	widerPath,
} from './docs-screenshots';

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const SHOT: Shot = {
	id: 'concepts/instances/instances',
	pages: ['concepts/instances#under the opening paragraphs'],
	source: 'reference',
	images: ['webgpu/demo-instances.png'],
	alt: 'A field of columns.',
	caption: 'One dynamic batch.',
	files: ['examples/instances/sketch.ts'],
	verdict: 'shots-concepts__instances.md',
};

/** One run of the image test manifest, as far as this tool reads it. */
function run(overrides: Partial<ImageRun> = {}): ImageRun {
	return {
		id: 'demo-instances-webgpu',
		test: 'demo-instances',
		tier: 'webgpu',
		path: '/tests/pages/image.html?gpu=webgpu&hold=1&size=320x180&sketch=/examples/instances/sketch.ts',
		scene: 'examples/instances/sketch.ts',
		timeoutSeconds: 60,
		size: [320, 180],
		hold: 1,
		expect: {},
		reference: { test: 'demo-instances', tier: 'webgpu', devices: [] },
		tolerance: { threshold: 0.1, maxDiffRatio: 0.01 },
		deviceTolerance: { threshold: 0.1, maxDiffRatio: 0.01 },
		...overrides,
	} as ImageRun;
}

describe('resolveShot', () => {
	it('finds the run whose reference the shot names', () => {
		const resolved = resolveShot(SHOT, [run()]);
		expect(resolved.ok).toBe(true);
		if (resolved.ok) {
			expect(resolved.plan.test).toBe('demo-instances');
			expect(resolved.plan.tier).toBe('webgpu');
		}
	});

	it('leaves out a shot with no reference image', () => {
		const resolved = resolveShot({ ...SHOT, images: undefined }, [run()]);
		expect(resolved.ok).toBe(false);
	});

	it('leaves out a shot that joins several pictures', () => {
		const resolved = resolveShot({ ...SHOT, images: ['webgpu/a.png', 'webgpu/b.png'] }, [run()]);
		expect(resolved.ok).toBe(false);
		if (!resolved.ok) expect(resolved.reason).toContain('joins');
	});

	it('leaves out a reference that the manifest has no run for', () => {
		const resolved = resolveShot(SHOT, [run({ test: 'another' })]);
		expect(resolved.ok).toBe(false);
	});
});

describe('pictureSize', () => {
	it('keeps the picture aspect at the asked width', () => {
		expect(pictureSize([320, 180], 1600)).toEqual([1600, 900]);
		expect(pictureSize([480, 270], 1600)).toEqual([1600, 900]);
		expect(pictureSize([320, 256], 1600)).toEqual([1600, 1280]);
	});
});

describe('widerPath', () => {
	it('replaces the size switch', () => {
		expect(widerPath('/page?size=320x180&hold=1', [1600, 900])).toBe('/page?size=1600x900&hold=1');
	});

	it('adds the size switch when the page has none', () => {
		expect(widerPath('/page?hold=1', [1600, 900])).toBe('/page?hold=1&size=1600x900');
		expect(widerPath('/page', [1600, 900])).toBe('/page?size=1600x900');
	});
});

describe('shotDigest', () => {
	function root(): string {
		const dir = mkdtempSync(join(tmpdir(), 'null3d-shot-digest-'));
		dirs.push(dir);
		mkdirSync(join(dir, 'examples/instances'), { recursive: true });
		writeFileSync(join(dir, 'examples/instances/sketch.ts'), 'export const a = 1;\n');
		return dir;
	}

	const plan = {
		test: 'demo-instances',
		tier: 'webgpu',
		path: '/tests/pages/image.html?gpu=webgpu&hold=1&size=320x180',
		size: [320, 180] as const,
		timeoutSeconds: 60,
	};

	it('stays the same while the sources hold', () => {
		const dir = root();
		expect(shotDigest(SHOT, plan, [1600, 900], dir)).toBe(shotDigest(SHOT, plan, [1600, 900], dir));
	});

	it('changes when a source changes', () => {
		const dir = root();
		const before = shotDigest(SHOT, plan, [1600, 900], dir);
		writeFileSync(join(dir, 'examples/instances/sketch.ts'), 'export const a = 2;\n');
		expect(shotDigest(SHOT, plan, [1600, 900], dir)).not.toBe(before);
	});

	it('changes when the picture size changes', () => {
		const dir = root();
		expect(shotDigest(SHOT, plan, [1600, 900], dir)).not.toBe(
			shotDigest(SHOT, plan, [1200, 675], dir),
		);
	});
});

describe('readOptions', () => {
	it('reads the default options', () => {
		expect(readOptions([])).toEqual({ force: false, list: false, width: 1600 });
	});

	it('reads the flags', () => {
		expect(readOptions(['--force', '--list', '--only', 'instances', '--width', '1280'])).toEqual({
			force: true,
			list: true,
			only: 'instances',
			width: 1280,
		});
	});

	it('refuses an unknown option', () => {
		expect(() => readOptions(['--shout'])).toThrow('unknown option');
	});
});

describe('webpBytes', () => {
	it('encodes a frame as a WebP picture of its size', async () => {
		const width = 2;
		const height = 2;
		const data = new Uint8Array(width * height * 4).fill(120);
		const bytes = await webpBytes({ width, height, data });
		const meta = await new Bun.Image(bytes).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.width).toBe(width);
		expect(meta.height).toBe(height);
	});
});
