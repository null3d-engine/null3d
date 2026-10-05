import { describe, expect, it } from 'bun:test';
import {
	everyShader,
	type GlslProgram,
	type GlslStage,
	type ShaderBinding,
} from '../../generated/shaders';
import { DEPTH_SETUPS } from './depth';
import {
	createProgram,
	declaresUniform,
	type GlslTemplate,
	METAL_FAULT,
	MIN_UNIFORM_BLOCK_SLOTS,
	type Program,
	prepareProgram,
	RELINK_TAIL,
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

describe("WebGL2 links that Safari's Metal translator broke", () => {
	const STAGE = '#version 300 es\nvoid main() {}\n';
	const SOURCE: GlslProgram = {
		vertex: { source: STAGE, uniformBlocks: [], textures: [] },
		fragment: { source: STAGE, uniformBlocks: [], textures: [] },
	};
	const TEMPLATE: GlslTemplate = {
		shader: { webgl2: { permutation: 0, wgsl: null, glsl: { main: SOURCE } } },
		pipeline: 'main',
	};
	const FAULT_LOG = `Internal error while linking shader. ${METAL_FAULT}:\nno matching function for call to 'ANGLE_sf0f'`;

	/**
	 * A context whose links end with the logs of `links` in turn, where an empty log is a link that
	 * succeeded. It records the sources it compiles and the objects it deletes.
	 */
	function fakeContext(links: readonly string[]) {
		const sources: string[] = [];
		const deleted: unknown[] = [];
		const logs = new Map<object, string>();
		let count = 0;
		const gl = {
			LINK_STATUS: 0x8b82,
			VERTEX_SHADER: 0x8b31,
			FRAGMENT_SHADER: 0x8b30,
			createProgram: () => ({}),
			createShader: () => ({}),
			shaderSource: (_: unknown, source: string) => sources.push(source),
			compileShader: () => {},
			attachShader: () => {},
			linkProgram: (program: object) => logs.set(program, links[count++] ?? ''),
			getProgramParameter: (program: object) => logs.get(program) === '',
			getProgramInfoLog: (program: object) => logs.get(program) ?? '',
			getShaderInfoLog: () => '',
			deleteShader: (shader: unknown) => deleted.push(shader),
			deleteProgram: (program: unknown) => deleted.push(program),
			detachShader: () => {},
			useProgram: () => {},
			getUniformLocation: () => null,
		} as unknown as WebGL2RenderingContext;
		return { gl, sources, deleted, links: () => count };
	}

	it('links the program again, from fresh translations, after the Metal fault', () => {
		const context = fakeContext([FAULT_LOG, '']);
		const program = createProgram(context.gl, TEMPLATE, 0);
		const first = program.program;
		prepareProgram(context.gl, program, DEPTH_SETUPS.reversed);
		expect(program.ready).toBe(true);
		expect(context.links()).toBe(2);
		expect(program.program).not.toBe(first);
		expect(context.deleted).toContain(first);
		expect(context.sources).toEqual([STAGE, STAGE, STAGE + RELINK_TAIL, STAGE + RELINK_TAIL]);
	});

	it('reports a second Metal fault, and links no third time', () => {
		const context = fakeContext([FAULT_LOG, FAULT_LOG, '']);
		const program = createProgram(context.gl, TEMPLATE, 0);
		expect(() => prepareProgram(context.gl, program, DEPTH_SETUPS.reversed)).toThrow(
			/failed to link twice, the second time after a fault in its Metal: .*no matching function/s,
		);
		expect(context.links()).toBe(2);
	});

	it('reports any other link failure at once', () => {
		const context = fakeContext(["ERROR: 'colour' : undeclared identifier"]);
		const program = createProgram(context.gl, TEMPLATE, 0);
		expect(() => prepareProgram(context.gl, program, DEPTH_SETUPS.reversed)).toThrow(
			"a WebGL2 program failed to link: ERROR: 'colour' : undeclared identifier",
		);
		expect(context.links()).toBe(1);
	});
});
