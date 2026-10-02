// Starts a sketch that holds WGSL in both forms that the null3D Vite plugin compiles, and asks it
// for both. Each must arrive as a compiled shader, not as WGSL text. The page then compiles each
// GLSL program in WebGL2 and each WGSL module in WebGPU, as the shaders page does for the engine's
// own shaders, and reports what each shader holds.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';
import { checkGlslPrograms, checkWgslModules, type ShaderFailure } from './lib/shader-checks';

const sketch = new URL('./sketches/shader-sketch.ts', import.meta.url);

/** A compiled whole shader, of the type that the plugin's client types give a `.wgsl` import. */
type CompiledShader = Extract<
	typeof import('./sketches/shaders/tint.wgsl').default,
	{ kind: 'shader' }
>;

/** What a compiled shader holds: its pipelines, and the library code that its WGSL imported. */
function summary(shader: CompiledShader) {
	return {
		wgslPipelines: Object.keys(shader.webgpu.wgsl?.pipelines ?? {}),
		glslPrograms: Object.keys(shader.webgl2?.glsl ?? {}),
		wgsl: shader.webgpu.wgsl?.source ?? '',
		glslFragments: Object.values(shader.webgl2?.glsl ?? {}).map((p) => p.fragment.source),
	};
}

run('sketch-shaders', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({ canvas, sketch });
	const shaders = await new Promise<Record<string, CompiledShader>>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'shaders') resolve(data as Record<string, CompiledShader>);
		});
		engine.postToSketch('shaders');
	});
	await engine.destroy();
	const entries = Object.entries(shaders);
	const failures: ShaderFailure[] = [];
	const glsl = await checkGlslPrograms(
		entries.flatMap(([name, shader]) =>
			Object.entries(shader.webgl2?.glsl ?? {}).map(
				([pipeline, program]) => [`${name}.${pipeline}`, program] as const,
			),
		),
		failures,
	);
	const wgsl = await checkWgslModules(
		entries.flatMap(([name, shader]) =>
			shader.webgpu.wgsl ? [[name, shader.webgpu.wgsl.source] as const] : [],
		),
		failures,
	);
	return {
		kinds: Object.fromEntries(entries.map(([name, shader]) => [name, typeof shader])),
		shaders: Object.fromEntries(entries.map(([name, shader]) => [name, summary(shader)])),
		glslPrograms: glsl.programs,
		webgpu: wgsl.webgpu,
		wgslModules: wgsl.modules,
		failures,
	};
});
