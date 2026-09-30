// Compiles every shader in the generated shader module in this browser. Each GLSL program must
// compile and link in WebGL2, and every uniform block and texture that the reflection names must
// exist in the linked program. Each WGSL module must compile in WebGPU when the browser has it.
// Failures carry the browser's info logs.
import { SHADERS, type ShaderVariant } from '@null3d/engine/internal';
import { run } from './lib/result';
import { checkGlslPrograms, checkWgslModules, type ShaderFailure } from './lib/shader-checks';

/** Every variant of every shader, with its name. */
const VARIANTS = Object.entries(SHADERS).flatMap(([shaderName, variants]) =>
	Object.entries(variants as Record<string, ShaderVariant>).map(
		([variantName, variant]) => [`${shaderName}.${variantName}`, variant] as const,
	),
);

run('shaders', async () => {
	const failures: ShaderFailure[] = [];
	const glsl = checkGlslPrograms(
		VARIANTS.flatMap(([name, variant]) =>
			Object.entries(variant.glsl ?? {}).map(
				([pipeline, program]) => [`${name}.${pipeline}`, program] as const,
			),
		),
		failures,
	);
	const wgsl = await checkWgslModules(
		VARIANTS.flatMap(([name, variant]) =>
			variant.wgsl ? [[name, variant.wgsl.source] as const] : [],
		),
		failures,
	);
	return {
		glslPrograms: glsl.programs,
		multiDraw: glsl.multiDraw,
		skipped: glsl.skipped,
		renderer: glsl.renderer,
		webgpu: wgsl.webgpu,
		wgslModules: wgsl.modules,
		failures,
	};
});
