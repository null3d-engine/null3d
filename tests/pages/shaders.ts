// Compiles every variant of the generated shader modules in this browser. Each GLSL program must
// compile and link in WebGL2, and every uniform block and texture that the reflection names must
// be declared in its source. The ones that the driver removed, because the program never reads
// them, are listed apart. Each WGSL module must compile in WebGPU when the browser has it,
// with the device feature `shader-f16` for the modules at half precision where the adapter has it.
// Failures carry the browser's info logs. The result gives the time the GLSL programs took.
import { everyShader } from '@null3d/engine/internal';
import { run } from './lib/result';
import { checkGlslPrograms, checkWgslModules, type ShaderFailure } from './lib/shader-checks';
import { glslProgramsOf, wgslModulesOf } from './lib/shader-list';

run('shaders', async () => {
	// Every shader of the main module and of each device module.
	const shaders = await everyShader();
	const failures: ShaderFailure[] = [];
	const glslStart = performance.now();
	const glsl = await checkGlslPrograms(glslProgramsOf(shaders), failures);
	const glslSeconds = Math.round(performance.now() - glslStart) / 1000;
	const wgsl = await checkWgslModules(wgslModulesOf(shaders), failures);
	return {
		glslPrograms: glsl.programs,
		glslSeconds,
		multiDraw: glsl.multiDraw,
		parallelCompile: glsl.parallel,
		skipped: glsl.skipped,
		removed: glsl.removed,
		renderer: glsl.renderer,
		webgpu: wgsl.webgpu,
		wgslModules: wgsl.modules,
		wgslSkipped: wgsl.skipped,
		failures,
	};
});
