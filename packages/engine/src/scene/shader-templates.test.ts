import { describe, expect, test } from 'bun:test';
import { SHADING_CUSTOM_FIRST } from '../generated/core';
import type { ShaderVariants } from '../generated/shaders';
import type { CustomShader } from '../shared/images';
import { ShaderTemplates } from './shader-templates';

/** A build for one GPU path. */
const wgsl = (permutation: number) => ({
	permutation,
	wgsl: { source: `// wgsl ${permutation}`, pipelines: { main: { vertex: 'vs', fragment: 'fs' } } },
	glsl: null,
});
const glsl = (permutation: number) => ({
	permutation,
	wgsl: null,
	glsl: {
		main: {
			vertex: { source: `// vertex ${permutation}`, uniformBlocks: [], textures: [] },
			fragment: { source: `// fragment ${permutation}`, uniformBlocks: [], textures: [] },
		},
	},
});

/** A custom material's shader with builds of both paths. */
const shader = (skinBuilds?: boolean): CustomShader => ({
	variants: { webgpu: wgsl(0), webgl2: glsl(0) } as unknown as ShaderVariants,
	locations: [0, 1, 2],
	textures: 0,
	...(skinBuilds && { skinBuilds }),
});

/** Templates that record what they send, for the GPU path `target`. */
function recording(target?: 'wgsl' | 'glsl') {
	const sent: [number, CustomShader][] = [];
	const builds: [number, ShaderVariants | string][] = [];
	const templates = new ShaderTemplates(
		(template, sentShader) => sent.push([template, sentShader]),
		target,
		(template, sentBuilds) => builds.push([template, sentBuilds]),
	);
	return { templates, sent, builds };
}

const skinBuilds = { webgpu_skin: wgsl(64) } as unknown as ShaderVariants;

describe('the templates of compiled WGSL', () => {
	test("send the builds of the page's GPU path only", () => {
		for (const target of ['wgsl', 'glsl'] as const) {
			const { templates, sent } = recording(target);
			templates.of({}, () => [shader()]);
			expect(Object.keys(sent[0]?.[1].variants ?? {})).toEqual([
				target === 'wgsl' ? 'webgpu' : 'webgl2',
			]);
		}
	});

	test('import the builds that load on first use when the thread that draws asks, once', async () => {
		const { templates, sent, builds } = recording('wgsl');
		let imports = 0;
		const later = async () => {
			imports++;
			return { variants: skinBuilds };
		};
		const template = templates.of({}, () => [shader(true)], undefined, later);
		expect(template).toBe(SHADING_CUSTOM_FIRST);
		expect(sent[0]?.[1].skinBuilds).toBe(true);
		expect(imports).toBe(0);
		templates.answer(template);
		await Promise.resolve();
		await Promise.resolve();
		expect(imports).toBe(1);
		expect(builds).toEqual([[template, skinBuilds]]);
		// A second ask finds nothing more to import.
		templates.answer(template);
		expect(builds.at(-1)).toEqual([template, 'the sketch holds no such builds']);
	});

	test('send why the builds that load on first use did not load', async () => {
		const { templates, builds } = recording('wgsl');
		const template = templates.of(
			{},
			() => [shader(true)],
			undefined,
			() => Promise.reject(new Error('the network failed')),
		);
		templates.answer(template);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(builds).toEqual([[template, 'the network failed']]);
	});

	test('on WebGL2, which has the builds that skin with the others, ask for nothing', () => {
		const { templates, sent } = recording('glsl');
		templates.of(
			{},
			() => [shader(true)],
			undefined,
			async () => ({ variants: skinBuilds }),
		);
		expect(sent[0]?.[1].skinBuilds).toBeUndefined();
	});
});
