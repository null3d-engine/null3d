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

/** A custom material's shader with builds of both paths, or one whose builds load on first use. */
const shader = (builds?: boolean): CustomShader => ({
	variants: builds ? {} : ({ webgpu: wgsl(0), webgl2: glsl(0) } as unknown as ShaderVariants),
	locations: [0, 1, 2],
	textures: 0,
	...(builds && { builds }),
});

/** The permutation bits of the sets in these tests: tone mapping, and skinning. */
const TONE_MAP = 2;
const SKIN = 64;

/** Templates that record what they send, for the GPU path `target` and a device that tone maps. */
function recording(target?: 'wgsl' | 'glsl') {
	const sent: [number, CustomShader][] = [];
	const builds: [number, number, ShaderVariants | string][] = [];
	const templates = new ShaderTemplates(
		(template, sentShader) => sent.push([template, sentShader]),
		target,
		(template, set, sentBuilds) => builds.push([template, set, sentBuilds]),
		TONE_MAP,
	);
	return { templates, sent, builds };
}

/** Lets the promises that are under way settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

	test("import the device's set at the first use, and each other set once when the thread that draws asks", async () => {
		for (const target of ['wgsl', 'glsl'] as const) {
			const { templates, sent, builds } = recording(target);
			const imports: [string, number][] = [];
			const later = async (path: string, set: number) => {
				imports.push([path, set]);
				return { [`build_${set}`]: wgsl(set) } as unknown as ShaderVariants;
			};
			const template = templates.of({}, () => [shader(true)], undefined, later);
			expect(template).toBe(SHADING_CUSTOM_FIRST);
			expect(sent[0]?.[1].builds).toBe(true);
			expect(imports).toEqual([[target, TONE_MAP]]);
			templates.answer(template, TONE_MAP | SKIN);
			templates.answer(template, TONE_MAP | SKIN);
			templates.answer(template, TONE_MAP);
			await settle();
			expect(imports).toEqual([
				[target, TONE_MAP],
				[target, TONE_MAP | SKIN],
			]);
			expect(builds.map(([t, set]) => [t, set])).toEqual([
				[template, TONE_MAP],
				[template, TONE_MAP | SKIN],
			]);
		}
	});

	test('import set 0 first for a shader whose builds take one set for each GPU path', async () => {
		const { templates } = recording('wgsl');
		const imports: [string, number][] = [];
		const later = async (path: string, set: number) => {
			imports.push([path, set]);
			return { build: wgsl(0) } as unknown as ShaderVariants;
		};
		const shaderSet = { ...shader(true), buildsSet: 0 };
		templates.of({}, () => [shaderSet], undefined, later);
		expect(imports).toEqual([['wgsl', 0]]);
	});

	test('import the builds of each template that a tone curve makes', async () => {
		const { templates, sent } = recording('glsl');
		const imports: [string, number][] = [];
		const later = async (path: string, set: number) => {
			imports.push([path, set]);
			return { build: glsl(0) } as unknown as ShaderVariants;
		};
		const shaderOfCurve = (): CustomShader => ({ ...shader(true), buildsSet: 0 });
		const first = templates.of({}, () => [shaderOfCurve(), shaderOfCurve()], undefined, later);
		expect(imports).toEqual([
			['glsl', 0],
			['glsl', 0],
		]);
		expect(sent.map(([template]) => template)).toEqual([first, first + 1]);
	});

	test('send why a set did not load', async () => {
		const { templates, builds } = recording('wgsl');
		const template = templates.of(
			{},
			() => [shader(true)],
			undefined,
			() => Promise.reject(new Error('the network failed')),
		);
		await settle();
		expect(builds).toEqual([[template, TONE_MAP, 'the network failed']]);
	});

	test('answer an ask for a template without such builds with a reason', () => {
		const { templates, builds } = recording('wgsl');
		const template = templates.of({}, () => [shader()]);
		templates.answer(template, SKIN);
		expect(builds).toEqual([[template, SKIN, 'the sketch holds no such builds']]);
	});
});
