import { describe, expect, it } from 'bun:test';
import {
	type GlslProgram,
	type GlslStage,
	SHADERS,
	type ShaderBinding,
} from '../../generated/shaders';
import { MIN_UNIFORM_BLOCK_SLOTS, slotOf, UPLOAD_UNIT } from './programs';

/** Every GLSL stage that the shader build writes, by a name that says where it comes from. */
function glslStages(): [string, GlslStage][] {
	const stages: [string, GlslStage][] = [];
	for (const [shader, variants] of Object.entries(SHADERS)) {
		for (const [variant, built] of Object.entries(variants)) {
			const programs: Record<string, GlslProgram> = built.glsl ?? {};
			for (const [pipeline, program] of Object.entries(programs)) {
				const name = `${shader}.${variant}.${pipeline}`;
				stages.push([`${name}.vertex`, program.vertex], [`${name}.fragment`, program.fragment]);
			}
		}
	}
	return stages;
}

const key = (b: ShaderBinding) => `${b.group}:${b.binding}`;

describe('WebGL2 slots of bind groups', () => {
	const stages = glslStages();

	it('finds the GLSL shaders', () => {
		expect(stages.length).toBeGreaterThan(0);
	});

	it('gives every binding that a shader reads a slot of its own', () => {
		const owners = new Map<number, string>();
		for (const [, stage] of stages) {
			const bindings: ShaderBinding[] = [...stage.uniformBlocks];
			for (const texture of stage.textures) {
				bindings.push(texture);
				if (texture.sampler) bindings.push(texture.sampler);
			}
			for (const binding of bindings) {
				const slot = slotOf(binding.group, binding.binding);
				expect(Number.isInteger(slot)).toBe(true);
				const owner = owners.get(slot) ?? key(binding);
				expect(owner).toBe(key(binding));
				owners.set(slot, owner);
			}
		}
	});

	it('keeps uniform blocks within the binding points and textures below the upload unit', () => {
		for (const [name, stage] of stages) {
			for (const block of stage.uniformBlocks) {
				expect([name, slotOf(block.group, block.binding) < MIN_UNIFORM_BLOCK_SLOTS]).toEqual([
					name,
					true,
				]);
			}
			for (const texture of stage.textures) {
				expect([name, slotOf(texture.group, texture.binding) < UPLOAD_UNIT]).toEqual([name, true]);
			}
		}
	});
});
