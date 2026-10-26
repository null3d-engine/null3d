import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CURL_STEP, GROUND_HEIGHT, PUSH_LIFE } from './analytic';

/** The analytic field's text in one shader, between its markers. */
function analyticBlock(file: string): string {
	const text = readFileSync(new URL(file, import.meta.url), 'utf8');
	const start = text.indexOf('// <analytic-field>');
	const end = text.indexOf('// </analytic-field>');
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return text.slice(start + '// <analytic-field>'.length, end).trim();
}

/** The block between two markers of a file, trimmed. */
function marked(file: URL, name: string): string {
	const text = readFileSync(file, 'utf8');
	const start = text.indexOf(`// <${name}>`);
	const end = text.indexOf(`// </${name}>`);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return text.slice(start + `// <${name}>`.length, end).trim();
}

describe('the shaders of the grid', () => {
	test('the compute form and the WebGL2 fragment form hold one analytic field', () => {
		// The shader build resolves only the engine's library, so a shader cannot import another
		// shader of the add-on. The two forms therefore carry copies, and this keeps them equal.
		expect(analyticBlock('./grid.fallback.wgsl')).toBe(analyticBlock('./grid.wgsl'));
	});

	test('the shaders’ constants are the TypeScript form’s', () => {
		const text = analyticBlock('./grid.wgsl');
		const constant = (name: string): number => {
			const match = new RegExp(`const ${name}: f32 = ([0-9.]+);`).exec(text);
			expect(match).not.toBeNull();
			return Number(match?.[1]);
		};
		expect(constant('WIND_GROUND_HEIGHT')).toBe(GROUND_HEIGHT);
		expect(constant('WIND_PUSH_LIFE')).toBe(PUSH_LIFE);
		expect(constant('WIND_CURL_STEP')).toBe(CURL_STEP);
	});

	test('both forms write the wind the same way', () => {
		// The texture holds the wind across the ground and, in its fourth channel, the local speed,
		// which a leaf reads to flutter harder in a gust.
		const compute = readFileSync(new URL('./grid.wgsl', import.meta.url), 'utf8');
		const fallback = readFileSync(new URL('./grid.fallback.wgsl', import.meta.url), 'utf8');
		expect(compute).toContain('vec4f(v.x, v.y, v.z, length(v))');
		expect(fallback).toContain('vec4f(v.x, v.y, v.z, length(v))');
		// The box arrives in the eighth value vector, and the settings in the seven before it.
		expect(compute).toContain('let box = block.u7;');
		expect(fallback).toContain('let box = uniforms.u7;');
	});
});

describe('the sampling function', () => {
	test('the page reads the field with the add-on’s one copy of it', () => {
		// The shader build resolves only the engine's library, so a reader holds a copy. The page's
		// card material is the first reader, and this fails when either copy is edited alone.
		const canonical = marked(new URL('../shaders/field.wgsl', import.meta.url), 'wind-sample');
		const page = marked(new URL('../page/sketch.ts', import.meta.url), 'wind-sample');
		expect(page).toBe(canonical);
	});

	test('the copy names the texture and the sampler that a reader declares', () => {
		const canonical = marked(new URL('../shaders/field.wgsl', import.meta.url), 'wind-sample');
		expect(canonical).toContain('fn wind_sample(');
		expect(canonical).toContain('textureSampleLevel(wind, windSampler');
	});
});
