import { describe, expect, it } from 'bun:test';
import { ShaderPack } from './pack';
import type { CompiledMaterial, ShaderVariant } from './shader-types';
import { SKIN_BUILDS, SKIN_BUILDS_ADDRESS, SkinBuilds } from './skin-builds';

/** A WebGPU build with the permutation bits of `permutation`. */
const build = (permutation: number): ShaderVariant => ({
	permutation,
	wgsl: { source: `// ${permutation}`, pipelines: { main: { vertex: 'vs', fragment: 'fs' } } },
	glsl: null,
});

/** A custom material with the WebGPU builds that skin of `skins`. */
const material = (skins?: Record<string, ShaderVariant>): CompiledMaterial => ({
	kind: 'material',
	functions: ['surface'],
	uniforms: [],
	textures: [],
	variants: { webgpu: build(0) },
	...(skins && { skinVariants: skins }),
	locations: [0, 1, 2],
	attributes: 0,
	baseColor: true,
	objectIds: false,
});

describe('skin builds', () => {
	it("go to a module of their own, which the material's value imports", () => {
		const skins = new SkinBuilds();
		const pack = new ShaderPack();
		const value = skins.value(pack, material({ webgpu_skin: build(64) }));
		const address = value.match(/import\("([^"]+)"\)/)?.[1] ?? '';
		expect(address.startsWith(SKIN_BUILDS)).toBe(true);
		expect(SKIN_BUILDS_ADDRESS.test(address)).toBe(true);
		expect(value).not.toContain('skinVariants');
		const module = skins.module(`\0${address}`) ?? '';
		expect(module).toContain('webgpu_skin');
		expect(module).toContain('// 64');
	});

	it('leave a material without them, and any other shader, as the pack gives it', () => {
		const skins = new SkinBuilds();
		const pack = new ShaderPack();
		for (const shader of [material(), material({})])
			expect(skins.value(pack, shader)).not.toContain('import(');
		expect(skins.module(`\0${SKIN_BUILDS}0123456789abcdef`)).toBeUndefined();
	});
});
