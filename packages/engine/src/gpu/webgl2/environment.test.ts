import { describe, expect, it } from 'bun:test';
import type { GlslProgram, ShaderVariant } from '../../generated/shaders';
import { ENVIRONMENT_SHADER } from '../../generated/shaders-environment-glsl';
import { buildLayer } from './environment';
import { type ProgramHost, slotOf } from './programs';

/** The environment shader's WebGL2 build, by pipeline, which a map's generator is given. */
const GLSL = ENVIRONMENT_SHADER.webgl2.glsl as Readonly<Record<string, GlslProgram>>;

/** The variant of the layer that a page sends; the stand-in host reads none of its text. */
const LAYER = { permutation: 0, wgsl: null, glsl: GLSL } as ShaderVariant<string>;

/**
 * The texture unit that the backend gives a binding of a program: its place among the slots that
 * the program's stages declare, in the order the backend visits them. A stage that reads no
 * texture at a binding has no uniform for it, so the lookup refuses, as the backend does.
 */
function unitOf(built: GlslProgram, group: number, binding: number): number {
	const slots: number[] = [];
	for (const texture of [...built.vertex.textures, ...built.fragment.textures]) {
		const slot = slotOf(texture.group, texture.binding);
		if (!slots.includes(slot)) slots.push(slot);
	}
	const at = slots.indexOf(slotOf(group, binding));
	if (at < 0)
		throw new Error(`a WebGL2 program reads no texture at group ${group}, binding ${binding}`);
	return at;
}

/**
 * A program host that links no GL program: it names a program by its pipeline, and answers each
 * texture unit from the shader build, as the backend's own lookup does.
 */
function hostOf(glsl: Readonly<Record<string, GlslProgram>>): ProgramHost {
	return {
		program(template: { pipeline: string }) {
			return { pipeline: template.pipeline } as unknown as WebGLProgram;
		},
		unit(asked: WebGLProgram, group: number, binding: number) {
			const { pipeline } = asked as unknown as { pipeline: string };
			return unitOf(glsl[pipeline] as GlslProgram, group, binding);
		},
	} as unknown as ProgramHost;
}

describe("a sky layer's texture units", () => {
	it('takes the cube from the capture, which is the one program of the layer that samples it', () => {
		const programs = buildLayer(hostOf(GLSL), LAYER);
		// A layer's draw of the sky samples no cube, so the backend refuses a unit asked of it.
		expect(() => hostOf(GLSL).unit(programs.sky, 0, 1)).toThrow(
			'a WebGL2 program reads no texture at group 0, binding 1',
		);
		expect(programs.units.cube).toBe(unitOf(GLSL.feedback as GlslProgram, 0, 1));
		expect(programs.units.panorama).toBe(unitOf(GLSL.panorama as GlslProgram, 0, 3));
	});
});
