// Checks the WebGL2 texture-unit allocator against the units that the device reports. A fragment
// shader declares one texture more than the engine hands a stage, and the engine must refuse it
// with E1209 before it reads the link result: the program must not reach the page as a plain link
// failure. The program is built by hand, so the declared list is the device's real count rather
// than a made-up one, and the page also reports whether the driver refused the program by itself.
import {
	DEPTH_SETUPS,
	type Program,
	prepareProgram,
	stageTextureUnits,
	stageUnitCount,
} from '@null3d/engine/internal';
import { run } from './lib/result';

/** A GLSL stage's declared textures, in the form that the allocator counts. */
function texturesOf(count: number) {
	return Array.from({ length: count }, (_, binding) => ({
		name: `tex${binding}`,
		group: 3,
		binding,
		sampler: null,
	}));
}

/** A fragment shader that samples every sampler uniform that it declares. */
function fragmentSource(count: number): string {
	const lines = ['#version 300 es', 'precision highp float;'];
	for (let k = 0; k < count; k++) lines.push(`uniform sampler2D tex${k};`);
	lines.push('out vec4 color;', 'void main() {', '\tvec2 uv = vec2(0.5);', '\tfloat sum = 0.0;');
	for (let k = 0; k < count; k++) lines.push(`\tsum += texture(tex${k}, uv).r;`);
	lines.push('\tcolor = vec4(sum);', '}');
	return lines.join('\n');
}

const VERTEX_SOURCE = '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }\n';

/** Compiles and links two shaders, and returns the program with the shaders that made it. */
function build(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	fragmentSourceText: string,
): { program: WebGLProgram; shaders: WebGLShader[] } {
	const compile = (type: number, source: string): WebGLShader => {
		const shader = gl.createShader(type);
		if (!shader) throw new Error('the context made no shader');
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return shader;
	};
	const program = gl.createProgram();
	if (!program) throw new Error('the context made no program');
	const shaders = [
		compile(gl.VERTEX_SHADER, vertexSource),
		compile(gl.FRAGMENT_SHADER, fragmentSourceText),
	];
	for (const shader of shaders) gl.attachShader(program, shader);
	gl.linkProgram(program);
	return { program, shaders };
}

run('program-units', async () => {
	const canvas = document.createElement('canvas');
	const gl = canvas.getContext('webgl2');
	if (!gl) throw new Error('the page has no WebGL2 context');
	const device = {
		vertex: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number,
		fragment: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
	};
	// The units that the engine hands out, which keep the last of the context's units for uploads.
	const units = stageTextureUnits(gl);
	const declared = units[1] + 1;
	const built = build(gl, VERTEX_SOURCE, fragmentSource(declared));
	const driverLinked = gl.getProgramParameter(built.program, gl.LINK_STATUS) as boolean;
	const stage = {
		source: fragmentSource(declared),
		uniformBlocks: [],
		textures: texturesOf(declared),
	};
	const program: Program = {
		program: built.program,
		source: {
			vertex: { source: VERTEX_SOURCE, uniformBlocks: [], textures: [] },
			fragment: stage,
		},
		shaders: built.shaders,
		firstInstance: null,
		firstInstanceValue: 0,
		textureUnits: [],
		ready: false,
		background: false,
	};
	let code: string | null = null;
	let message: string | null = null;
	try {
		prepareProgram(gl, program, DEPTH_SETUPS.reversed);
	} catch (error) {
		const thrown = error as { code?: string; message: string };
		code = thrown.code ?? null;
		message = thrown.message;
	}
	return {
		device,
		units,
		declared,
		counted: stageUnitCount(stage),
		driverLinked,
		code,
		message,
	};
});
