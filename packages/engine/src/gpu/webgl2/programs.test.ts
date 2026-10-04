import { describe, expect, it } from 'bun:test';
import {
	everyShader,
	type GlslProgram,
	type GlslStage,
	type ShaderBinding,
} from '../../generated/shaders';
import { DEPTH_SETUPS } from './depth';
import {
	declaresUniform,
	MIN_UNIFORM_BLOCK_SLOTS,
	type Program,
	prepareProgram,
	slotOf,
	UPLOAD_UNIT,
} from './programs';

const SHADERS = await everyShader();

/**
 * Every GLSL stage that the shader build writes, those of every device module too, by a name that
 * says where it comes from.
 */
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

describe('WebGL2 programs that a driver optimized', () => {
	it('declares every uniform block and texture that a reflection names in its stage', () => {
		for (const [name, stage] of glslStages()) {
			const names = [...stage.uniformBlocks, ...stage.textures].map((b) => b.name);
			for (const uniform of names)
				expect([name, uniform, declaresUniform(stage.source, uniform)]).toEqual([
					name,
					uniform,
					true,
				]);
		}
		expect(declaresUniform('uniform highp sampler2D other;', 'missing')).toBe(false);
		expect(declaresUniform('vec4 a = texture(missing, uv);', 'missing')).toBe(false);
	});

	it('binds the textures and blocks that the driver kept, and skips the ones it removed', () => {
		const kept = { name: 'kept_fs', group: 0, binding: 4, sampler: { group: 0, binding: 5 } };
		const removed = { name: 'removed_fs', group: 0, binding: 9, sampler: { group: 0, binding: 5 } };
		const block = { name: 'Gone_block_0Fragment', group: 0, binding: 10 };
		const fragment: GlslStage = {
			source: `uniform highp sampler2DArrayShadow ${kept.name};\nuniform highp sampler2DArrayShadow ${removed.name};\nuniform ${block.name} { vec4 x; } g;`,
			uniformBlocks: [block],
			textures: [kept, removed],
		};
		const vertex: GlslStage = { source: '', uniformBlocks: [], textures: [] };
		const units = new Map<string, number>();
		const location = { name: kept.name };
		const gl = {
			LINK_STATUS: 0x8b82,
			INVALID_INDEX: 0xffffffff,
			getProgramParameter: () => true,
			detachShader: () => {},
			deleteShader: () => {},
			useProgram: () => {},
			getUniformBlockIndex: () => 0xffffffff,
			uniformBlockBinding: () => {
				throw new Error('a removed block took a binding');
			},
			getUniformLocation: (_: unknown, name: string) => (name === kept.name ? location : null),
			uniform1i: (at: { name: string }, unit: number) => units.set(at.name, unit),
			uniform2f: () => {},
		} as unknown as WebGL2RenderingContext;
		const program: Program = {
			program: {} as WebGLProgram,
			source: { vertex, fragment },
			shaders: [],
			firstInstance: null,
			firstInstanceValue: 0,
			samplerUnits: [],
			sampled: false,
			ready: false,
			background: false,
		};
		prepareProgram(gl, program, DEPTH_SETUPS.reversed);
		expect(program.ready).toBe(true);
		expect([...units]).toEqual([[kept.name, slotOf(kept.group, kept.binding)]]);
		expect(program.sampled).toBe(true);
	});
});
