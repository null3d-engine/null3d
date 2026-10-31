import { describe, expect, it } from 'bun:test';
import { PART_ENV } from '../../../../../tests/lib/heavy-checks.ts';
import {
	everyShader,
	type GlslProgram,
	type GlslStage,
	type GlslTexture,
	type ShaderBinding,
} from '../../generated/shaders';
import { DEPTH_SETUPS } from './depth';
import {
	checkStageUnits,
	createProgram,
	declaresUniform,
	type GlslTemplate,
	linkLogs,
	METAL_FAULT,
	MIN_STAGE_TEXTURE_UNITS,
	MIN_UNIFORM_BLOCK_SLOTS,
	metalFault,
	type Program,
	prepareProgram,
	RELINK_TAIL,
	relink,
	slotOf,
	stageUnitCount,
	UPLOAD_UNIT,
} from './programs';

/**
 * The part of the generated set that this process reads, as `part/parts`, or the whole set. The
 * check reads every GLSL build, whose sources make the set large, so it runs in parts: each part
 * holds its own share in a process of its own ([Test memory](../../../../../.dev/tests.md)).
 */
const PART = process.env[PART_ENV] ?? '1/1';
const [part = 1, parts = 1] = PART.split('/').map(Number);
if (!Number.isInteger(part) || !Number.isInteger(parts) || part < 1 || part > parts)
	throw new Error(`${PART_ENV} names no part of the set: ${PART}`);

const SHADERS = await everyShader(part, parts);

/**
 * Every GLSL program that the shader build writes, those of every device module too, by a name
 * that says where it comes from.
 */
function glslPrograms(): [string, GlslProgram][] {
	const found: [string, GlslProgram][] = [];
	for (const [shader, variants] of Object.entries(SHADERS)) {
		for (const [variant, built] of Object.entries(variants)) {
			const programs: Record<string, GlslProgram> = built.glsl ?? {};
			for (const [pipeline, program] of Object.entries(programs))
				found.push([`${shader}.${variant}.${pipeline}`, program]);
		}
	}
	return found;
}

/** Every GLSL stage that the shader build writes, by a name that says where it comes from. */
function glslStages(): [string, GlslStage][] {
	return glslPrograms().flatMap(([name, program]): [string, GlslStage][] => [
		[`${name}.vertex`, program.vertex],
		[`${name}.fragment`, program.fragment],
	]);
}

const key = (b: ShaderBinding) => `${b.group}:${b.binding}`;

/**
 * The texture units that every stage leaves free, for the per-pixel inputs of later features, such
 * as a grid of light probes or the tables of area lights. The builds that let light through take one
 * of them for the copy of the opaque color that they sample (decision record D-122), the decal
 * builds one for the scene depth that they read (decision record D-144), and the builds that shade
 * area lights one for their tables (D-145). The reflection probes' maps share that array at
 * binding 3, so they take no further unit where a build already reads it, and one unit where it
 * did not (D-149). The decal builds read no probes: a decal modulates the surface under it, which
 * reflects them already. Every lit build reads the screen-space reflections through that copy too
 * (D-134), which is why the number this test allows fell by one.
 */
const SPARE_TEXTURE_UNITS = 3;

/** The copy of the opaque color's binding in the scene shaders' frame group. */
const OPAQUE_COPY = { group: 0, binding: 15 };

/** The probes' maps' binding, which the light tables share in the scene shaders' frame group. */
const PROBES = { group: 0, binding: 3 };

/**
 * The spare texture units of a stage: one fewer where it samples the copy of the opaque color, and
 * one fewer where it samples the probes' maps.
 */
const spareUnits = (name: string, stage: GlslStage) => {
	const reads = (binding: { group: number; binding: number }) =>
		stage.textures.some(
			(texture) => texture.group === binding.group && texture.binding === binding.binding,
		);
	return (
		SPARE_TEXTURE_UNITS -
		(reads(OPAQUE_COPY) || name.includes('_transmission') || name.startsWith('decal') ? 1 : 0) -
		(reads(PROBES) ? 1 : 0)
	);
};

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

	it('keeps uniform blocks within the binding points', () => {
		for (const [name, stage] of stages) {
			for (const block of stage.uniformBlocks) {
				expect([name, slotOf(block.group, block.binding) < MIN_UNIFORM_BLOCK_SLOTS]).toEqual([
					name,
					true,
				]);
			}
		}
	});

	it('keeps each stage within the texture units that every device gives it, with room to spare', () => {
		let most: [string, number] = ['', 0];
		for (const [name, stage] of stages) {
			const units = new Set(stage.textures.map(key)).size;
			expect([name, units <= MIN_STAGE_TEXTURE_UNITS - spareUnits(name, stage)]).toEqual([
				name,
				true,
			]);
			if (units > most[1]) most = [name, units];
		}
		for (const [name, program] of glslPrograms()) {
			const units = new Set([...program.vertex.textures, ...program.fragment.textures].map(key));
			expect([name, units.size < UPLOAD_UNIT]).toEqual([name, true]);
		}
		console.log(
			`the most texture units in one stage: ${most[1]} of ${MIN_STAGE_TEXTURE_UNITS}, in ${most[0]}`,
		);
	});
});

describe('WebGL2 texture-unit allocator', () => {
	const texture = (binding: number): GlslTexture => ({
		name: `texture${binding}`,
		group: 3,
		binding,
		sampler: null,
	});
	const stage = (textures: GlslTexture[]): GlslStage => ({
		source: '',
		uniformBlocks: [],
		textures,
	});

	it('counts the distinct units that a stage reads', () => {
		expect(stageUnitCount(stage([texture(0), texture(0), texture(1)]))).toBe(2);
	});

	it('refuses a stage that reads one unit past the limit it is given', () => {
		const many = stage(
			Array.from({ length: MIN_STAGE_TEXTURE_UNITS + 1 }, (_, binding) => texture(binding)),
		);
		const thrown = (() => {
			try {
				checkStageUnits(many, 'fragment', MIN_STAGE_TEXTURE_UNITS);
				return null;
			} catch (error) {
				return error as { code?: string; message: string };
			}
		})();
		expect(thrown?.code).toBe('E1209');
		expect(thrown?.message).toContain(
			`reads ${MIN_STAGE_TEXTURE_UNITS + 1} textures in its fragment stage, and a stage has ${MIN_STAGE_TEXTURE_UNITS} units`,
		);
	});

	it('lets a stage that fills every unit draw', () => {
		const full = stage(
			Array.from({ length: MIN_STAGE_TEXTURE_UNITS }, (_, binding) => texture(binding)),
		);
		expect(() => checkStageUnits(full, 'fragment', MIN_STAGE_TEXTURE_UNITS)).not.toThrow();
	});

	it('holds a stage to the units that the device reports, not to the fewest of any device', () => {
		const many = stage(
			Array.from({ length: MIN_STAGE_TEXTURE_UNITS + 1 }, (_, binding) => texture(binding)),
		);
		expect(() => checkStageUnits(many, 'fragment', MIN_STAGE_TEXTURE_UNITS)).toThrow(/E1209/);
		expect(() => checkStageUnits(many, 'fragment', MIN_STAGE_TEXTURE_UNITS + 1)).not.toThrow();
		expect(() => checkStageUnits(many, 'fragment', 64)).not.toThrow();
	});

	/**
	 * A context that reports `fragmentUnits` for its fragment stage and links every program. It
	 * counts the link results that the engine asks for, which a refusal must come before.
	 */
	function deviceContext(fragmentUnits: number) {
		let linkChecks = 0;
		const gl = {
			LINK_STATUS: 0x8b82,
			INVALID_INDEX: 0xffffffff,
			MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b45,
			MAX_TEXTURE_IMAGE_UNITS: 0x8b46,
			getParameter: (parameter: number) =>
				parameter === 0x8b45 ? MIN_STAGE_TEXTURE_UNITS : fragmentUnits,
			getProgramParameter: () => {
				linkChecks++;
				return true;
			},
			detachShader: () => {},
			deleteShader: () => {},
			useProgram: () => {},
			getUniformBlockIndex: () => 0xffffffff,
			uniformBlockBinding: () => {},
			getUniformLocation: () => null,
			uniform1i: () => {},
			uniform2f: () => {},
		} as unknown as WebGL2RenderingContext;
		return { gl, linkChecks: () => linkChecks };
	}

	it('refuses a stage past the units that the device reports, before reading its link result', () => {
		const context = deviceContext(10);
		const fragment = stage(Array.from({ length: 12 }, (_, binding) => texture(binding)));
		const program: Program = {
			program: {} as WebGLProgram,
			source: { vertex: stage([]), fragment },
			shaders: [],
			firstInstance: null,
			firstInstanceValue: 0,
			textureUnits: [],
			ready: false,
			background: false,
		};
		const thrown = (() => {
			try {
				prepareProgram(context.gl, program, DEPTH_SETUPS.reversed);
				return null;
			} catch (error) {
				return error as { code?: string; message: string };
			}
		})();
		expect(thrown?.code).toBe('E1209');
		expect(thrown?.message).toContain(
			'reads 12 textures in its fragment stage, and a stage has 10 units',
		);
		// The device linked the program, so a refusal that read the link result would not have come.
		expect(context.linkChecks()).toBe(0);
	});
});

describe('WebGL2 multi-draw vertex shaders', () => {
	// Some Adreno drivers fail to link a program whose vertex shader reads a uniform array at the
	// draw index, with an empty log (see .dev/driver-bugs.md), so such shaders read a texture.
	it('read no uniform array at the draw index', () => {
		const multiDraw = glslPrograms().filter(([, program]) =>
			program.vertex.source.includes('gl_DrawID'),
		);
		expect(multiDraw.length).toBeGreaterThan(0);
		for (const [name, program] of multiDraw) {
			const read = program.vertex.source.match(/_group_\d+_binding_\d+_vs\.\w+\[[^\]]*\bdraw\b/);
			expect([name, read?.[0] ?? null]).toEqual([name, null]);
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
			MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b45,
			MAX_TEXTURE_IMAGE_UNITS: 0x8b46,
			getParameter: () => 16,
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
			textureUnits: [],
			ready: false,
			background: false,
		};
		prepareProgram(gl, program, DEPTH_SETUPS.reversed);
		expect(program.ready).toBe(true);
		// The kept texture takes the program's first unit, whatever its slot.
		expect([...units]).toEqual([[kept.name, 0]]);
		expect(program.textureUnits).toEqual([
			0,
			slotOf(kept.group, kept.binding),
			slotOf(kept.sampler.group, kept.sampler.binding),
		]);
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
	function fakeContext(links: readonly string[], shaderLogs: readonly string[] = []) {
		const sources: string[] = [];
		const deleted: unknown[] = [];
		const logs = new Map<object, string>();
		let count = 0;
		let shaders = 0;
		const gl = {
			LINK_STATUS: 0x8b82,
			VERTEX_SHADER: 0x8b31,
			FRAGMENT_SHADER: 0x8b30,
			// The units that a device reports, which every WebGL2 device gives a stage at least 16 of.
			MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b45,
			MAX_TEXTURE_IMAGE_UNITS: 0x8b46,
			getParameter: (parameter: number) => (parameter === 0x8b45 ? 32 : 16),
			createProgram: () => ({}),
			createShader: () => ({ log: shaderLogs[shaders++] ?? '' }),
			shaderSource: (_: unknown, source: string) => sources.push(source),
			compileShader: () => {},
			attachShader: () => {},
			linkProgram: (program: object) => logs.set(program, links[count++] ?? ''),
			getProgramParameter: (program: object) => logs.get(program) === '',
			getProgramInfoLog: (program: object) => logs.get(program) ?? '',
			getShaderInfoLog: (shader: { log: string }) => shader.log,
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

	it('links a program that is not in use again without waiting, as a hot shader swap does', () => {
		const context = fakeContext([FAULT_LOG, '']);
		const program = createProgram(context.gl, TEMPLATE, 0);
		const first = program.program;
		expect(metalFault(context.gl, program)).toBe(true);
		relink(context.gl, program);
		expect(program.ready).toBe(false);
		expect(program.program).not.toBe(first);
		expect(context.deleted).toContain(first);
		expect(metalFault(context.gl, program)).toBe(false);
		expect(context.sources).toEqual([STAGE, STAGE, STAGE + RELINK_TAIL, STAGE + RELINK_TAIL]);
	});

	it('reports any other link failure at once', () => {
		const context = fakeContext(["ERROR: 'colour' : undeclared identifier"]);
		const program = createProgram(context.gl, TEMPLATE, 0);
		expect(() => prepareProgram(context.gl, program, DEPTH_SETUPS.reversed)).toThrow(
			"a WebGL2 program failed to link: ERROR: 'colour' : undeclared identifier",
		);
		expect(context.links()).toBe(1);
	});

	it("names a shader's own errors, where the program's log says only that it did not compile", () => {
		const shaderError = "ERROR: 0:356: 'vignette' : no matching overloaded function found";
		const context = fakeContext(['Fragment shader is not compiled.'], ['', shaderError]);
		const program = createProgram(context.gl, TEMPLATE, 0);
		expect(linkLogs(context.gl, program)).toBe(`Fragment shader is not compiled.\n${shaderError}`);
		expect(() => prepareProgram(context.gl, program, DEPTH_SETUPS.reversed)).toThrow(shaderError);
	});
});
