import { describe, expect, it } from 'bun:test';
import type { GlslProgram } from '../../generated/shaders';
import { ENVIRONMENT_SHADER } from '../../generated/shaders-environment-glsl';
import { layerUnits } from './environment';
import { type ProgramHost, slotOf } from './programs';

/** The environment shader's WebGL2 build, by pipeline, which the map's generator is given. */
const GLSL = ENVIRONMENT_SHADER.webgl2.glsl as Readonly<Record<string, GlslProgram>>;

/** A program of that build, named by its pipeline. */
function program(name: string): WebGLProgram {
	return { pipeline: name } as unknown as WebGLProgram;
}

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

/** A program host whose lookups answer from the shader build, as the WebGL2 backend's would. */
function hostOf(glsl: Readonly<Record<string, GlslProgram>>): ProgramHost {
	return {
		unit(asked: WebGLProgram, group: number, binding: number) {
			const { pipeline } = asked as unknown as { pipeline: string };
			return unitOf(glsl[pipeline] as GlslProgram, group, binding);
		},
	} as unknown as ProgramHost;
}

describe("a sky layer's texture units", () => {
	it('asks the capture for the cube, which is the only one of its programs that samples it', () => {
		const host = hostOf(GLSL);
		// A layer's draw of the sky samples no cube, so a unit asked of it is refused.
		expect(() => host.unit(program('sky'), 0, 1)).toThrow(
			'a WebGL2 program reads no texture at group 0, binding 1',
		);
		const units = layerUnits(host, {
			feedback: program('feedback'),
			panorama: program('panorama'),
		});
		expect(units.cube).toBe(unitOf(GLSL.feedback as GlslProgram, 0, 1));
		expect(units.panorama).toBe(unitOf(GLSL.panorama as GlslProgram, 0, 3));
	});
});
