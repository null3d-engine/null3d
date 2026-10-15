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

	test('send why a set did not load, report it as E1424, and import it again at the next ask', async () => {
		const failures: string[] = [];
		const builds: [number, number, unknown][] = [];
		const templates = new ShaderTemplates(
			() => {},
			'wgsl',
			(template, set, sent) => builds.push([template, set, sent]),
			TONE_MAP,
			(error) => failures.push(`${error.code} ${error.message.split(' See ')[0]}`),
		);
		let imports = 0;
		const template = templates.of(
			{},
			() => [shader(true)],
			undefined,
			() => {
				imports++;
				return Promise.reject(new Error('the network failed'));
			},
		);
		await settle();
		expect(builds).toEqual([[template, TONE_MAP, 'the network failed']]);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toStartWith(
			'E1424 E1424: the builds of a custom material did not load: the network failed.',
		);
		// The thread that draws asks again after its wait, and the set imports again.
		templates.answer(template, TONE_MAP);
		await settle();
		expect(imports).toBe(2);
		expect(builds).toHaveLength(2);
	});

	test('answer an ask for a template without such builds with a reason', () => {
		const { templates, builds } = recording('wgsl');
		const template = templates.of({}, () => [shader()]);
		templates.answer(template, SKIN);
		expect(builds).toEqual([[template, SKIN, 'the sketch holds no such builds']]);
	});
});
