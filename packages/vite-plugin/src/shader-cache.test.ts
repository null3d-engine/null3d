import { afterEach, describe, expect, it } from 'bun:test';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashOf as sharedHashOf } from '../../../tools/lib/build-cache';
import { fixture } from '../../../tools/lib/fixture';
import { ShaderPack } from './pack';
import {
	NO_CACHE,
	NO_SHADER_CACHE,
	ShaderCache,
	shaderCacheFolder,
	shaderCacheOff,
} from './shader-cache';
import type {
	CompileResult,
	EffectResult,
	MaterialResult,
	MaterialSource,
	ShaderCompiler,
	ShaderSource,
	SkyLayerResult,
} from './shader-compiler';
import type { CompiledWgsl, ShaderVariant } from './shader-types';
import { compileWgslFile } from './wgsl';

/** A whole shader with a vertex and a fragment entry point. */
const SHADER = `@vertex
fn vs_main() -> @builtin(position) vec4f {
    return vec4f(0.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(1.0);
}
`;

/** One build of the shader, as a compiler that skips the real one gives it. */
function build(source: string): ShaderVariant {
	return {
		permutation: 0,
		wgsl: { source, pipelines: { fs_main: { vertex: 'vs_main', fragment: 'fs_main' } } },
		glsl: {
			fs_main: {
				vertex: { source: '#version 300 es', uniformBlocks: [], textures: [] },
				fragment: { source: '#version 300 es', uniformBlocks: [], textures: [] },
			},
		},
	};
}

/** A compiler that counts its calls and holds the whole shader it is given, for the tests. */
class CountingCompiler implements ShaderCompiler {
	calls = 0;

	async shader(shader: ShaderSource): Promise<CompileResult> {
		this.calls++;
		return {
			ok: true,
			variants: { webgpu: build(shader.source), webgl2: build(shader.source) },
			warnings: [],
		};
	}

	async material(material: MaterialSource): Promise<MaterialResult> {
		this.calls++;
		return {
			ok: true,
			material: {
				functions: ['surface'],
				uniforms: [],
				textures: [],
				variants: { webgpu: build(material.source) },
				locations: [],
				attributes: 0,
				baseColor: false,
				objectIds: false,
				sceneDepth: false,
			},
			warnings: [],
		};
	}

	async effect(effect: MaterialSource): Promise<EffectResult> {
		this.calls++;
		return {
			ok: true,
			effect: {
				function: 'effect',
				uniforms: [],
				depth: false,
				bloom: false,
				joins: false,
				textures: [],
				variants: { webgpu: build(effect.source) },
				pieces: { group: {}, fold: {} },
			},
			warnings: [],
		};
	}

	async skyLayer(layer: MaterialSource): Promise<SkyLayerResult> {
		this.calls++;
		return {
			ok: true,
			layer: { variants: { webgpu: build(layer.source) } },
			warnings: [],
		};
	}
}

/** A request to the compiler alone, which skips the plugin's own analysis of the WGSL. */
function request(over: Partial<ShaderSource> = {}): ShaderSource {
	return {
		path: 'src/glow.wgsl',
		source: SHADER,
		pipelines: { fs_main: { vertex: 'vs_main', fragment: 'fs_main' } },
		variants: { webgpu: { targets: ['wgsl'] }, webgl2: { defs: ['WEBGL2'], targets: ['glsl'] } },
		...over,
	};
}

/** The module text that the plugin emits for a compiled shader. */
function moduleOf(shader: CompiledWgsl): string {
	const pack = new ShaderPack();
	return `${pack.value(shader)}\n${pack.unpacker()}`;
}

afterEach(() => {
	delete process.env[NO_CACHE];
	delete process.env.NULL3D_NO_BUILD_CACHE;
	delete process.env[NO_SHADER_CACHE];
});

describe('the shader cache folder', () => {
	it('sits beside the asset tool cache, inside the project', () => {
		expect(shaderCacheFolder('/a/project')).toBe('/a/project/node_modules/.cache/null3d-shaders');
	});

	it('turns the cache off with the canonical opt-out or the plugin alias', () => {
		expect(shaderCacheOff()).toBe(false);
		process.env[NO_CACHE] = '1';
		expect(shaderCacheOff()).toBe(true);
		delete process.env[NO_CACHE];
		process.env[NO_SHADER_CACHE] = '1';
		expect(shaderCacheOff()).toBe(true);
	});
});

describe('the shader cache', () => {
	it('keys an entry the way the shared build cache hashes its inputs', async () => {
		const root = fixture({ 'package.json': '{}' });
		const cache = new ShaderCache(() => root, new CountingCompiler(), { version: 'test-1' });
		await cache.shader(request());
		// The format number is `FORMAT` in shader-cache.ts, and the version is the test's own.
		const key = sharedHashOf('1', 'test-1', 'shader', JSON.stringify(request()));
		expect(readdirSync(shaderCacheFolder(root))).toEqual([`${key}.json`]);
	});

	it('leaves no partial file behind after a write', async () => {
		const root = fixture({ 'package.json': '{}' });
		const cache = new ShaderCache(() => root, new CountingCompiler(), { version: 'test-1' });
		await cache.shader(request());
		for (const name of readdirSync(shaderCacheFolder(root))) expect(name).not.toEndWith('.partial');
	});

	it('compiles a second identical shader no again, and gives the same module', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const cache = new ShaderCache(() => root, inner, { version: 'test-1' });
		const first = await compileWgslFile('src/glow.wgsl', '/p/src/glow.wgsl', SHADER, cache);
		const second = await compileWgslFile('src/glow.wgsl', '/p/src/glow.wgsl', SHADER, cache);
		if (!('shader' in first) || !('shader' in second))
			throw new Error('the shader did not compile');
		expect(inner.calls).toBe(1);
		expect(second).toEqual(first);
		expect(moduleOf(second.shader)).toBe(moduleOf(first.shader));
	});

	it('compiles a changed source again', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const cache = new ShaderCache(() => root, inner, { version: 'test-1' });
		await compileWgslFile('src/glow.wgsl', '/p/src/glow.wgsl', SHADER, cache);
		await compileWgslFile(
			'src/glow.wgsl',
			'/p/src/glow.wgsl',
			SHADER.replace('vec4f(1.0)', 'vec4f(0.5)'),
			cache,
		);
		expect(inner.calls).toBe(2);
	});

	it('compiles a shader again after its path changes', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const cache = new ShaderCache(() => root, inner, { version: 'test-1' });
		await cache.shader(request());
		await cache.shader(request({ path: 'src/other.wgsl' }));
		expect(inner.calls).toBe(2);
	});

	it('compiles a changed variant spec again', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const cache = new ShaderCache(() => root, inner, { version: 'test-1' });
		await cache.shader(request());
		await cache.shader(request());
		expect(inner.calls).toBe(1);
		await cache.shader(request({ variants: { webgpu: { defs: ['BRIGHT'], targets: ['wgsl'] } } }));
		expect(inner.calls).toBe(2);
	});

	it('compiles a shader again after the compiler version changes', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const before = new ShaderCache(() => root, inner, { version: 'engine 1' });
		const after = new ShaderCache(() => root, inner, { version: 'engine 2' });
		await before.shader(request());
		await before.shader(request());
		expect(inner.calls).toBe(1);
		await after.shader(request());
		expect(inner.calls).toBe(2);
	});

	it('compiles everything again when the environment turns it off', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const cache = new ShaderCache(() => root, inner, {
			version: 'test-1',
			disabled: () => shaderCacheOff(),
		});
		await cache.shader(request());
		process.env[NO_CACHE] = '1';
		await cache.shader(request());
		expect(inner.calls).toBe(2);
	});

	it('caches a custom material and a custom effect, skin builds and all', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const cache = new ShaderCache(() => root, inner, { version: 'test-1' });
		const material = {
			path: 'src/stripes.wgsl',
			source: 'fn surface(input: SurfaceInput) -> Surface',
		};
		await cache.material(material);
		await cache.material(material);
		expect(inner.calls).toBe(1);
		const effect = { path: 'src/fog.wgsl', source: 'fn effect(input: EffectInput) -> vec4f' };
		await cache.effect(effect);
		await cache.effect(effect);
		expect(inner.calls).toBe(2);
	});

	it('compiles one request once, however many arrive at the same time', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const cache = new ShaderCache(() => root, inner, { version: 'test-1' });
		const results = await Promise.all([
			cache.shader(request()),
			cache.shader(request()),
			cache.shader(request()),
		]);
		expect(inner.calls).toBe(1);
		for (const result of results) expect(result).toEqual(results[0]);
	});

	it('compiles again when an entry does not parse, or holds no result', async () => {
		const root = fixture({ 'package.json': '{}' });
		const inner = new CountingCompiler();
		const cache = new ShaderCache(() => root, inner, { version: 'test-1' });
		await cache.shader(request());
		expect(inner.calls).toBe(1);
		const folder = shaderCacheFolder(root);
		const [entry] = readdirSync(folder);
		writeFileSync(join(folder, entry as string), 'not json');
		await cache.shader(request());
		expect(inner.calls).toBe(2);
		writeFileSync(join(folder, entry as string), JSON.stringify({ some: 'value' }));
		await cache.shader(request());
		expect(inner.calls).toBe(3);
	});
});
