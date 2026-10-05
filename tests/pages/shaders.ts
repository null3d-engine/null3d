// Compiles every variant of the generated shader modules in this browser. Each GLSL program must
// compile and link in WebGL2, and every uniform block and texture that the reflection names must
// be declared in its source. The ones that the driver removed, because the program never reads
// them, are listed apart. Each WGSL module must compile in WebGPU when the browser has it,
// with the device feature `shader-f16` for the modules at half precision where the adapter has it.
// Failures carry the browser's info logs. Programs that link at the second try after Safari's random
// Metal fault are listed apart. The result gives the time the GLSL programs took.
// With `?part=k&parts=n`, the page checks only part k of n of the programs and of the modules, so
// that several pages can share the work.
import { everyShader } from '@null3d/engine/internal';
import { run } from './lib/result';
import { checkGlslPrograms, checkWgslModules, type ShaderFailure } from './lib/shader-checks';
import { glslProgramsOf, partOf, wgslModulesOf } from './lib/shader-list';

const params = new URLSearchParams(location.search);
const part = Number(params.get('part') ?? 1);
const parts = Number(params.get('parts') ?? 1);

run('shaders', async () => {
	if (!Number.isInteger(part) || !Number.isInteger(parts) || part < 1 || part > parts)
		throw new Error(`no part ${params.get('part')} of ${params.get('parts')}`);
	// Every shader of the main module and of each device module.
	const shaders = await everyShader();
	const failures: ShaderFailure[] = [];
	const glslStart = performance.now();
	const glsl = await checkGlslPrograms(partOf(glslProgramsOf(shaders), part, parts), failures);
	const glslSeconds = Math.round(performance.now() - glslStart) / 1000;
	const wgsl = await checkWgslModules(partOf(wgslModulesOf(shaders), part, parts), failures);
	return {
		glslPrograms: glsl.programs,
		glslSeconds,
		multiDraw: glsl.multiDraw,
		parallelCompile: glsl.parallel,
		skipped: glsl.skipped,
		removed: glsl.removed,
		relinked: glsl.relinked,
		renderer: glsl.renderer,
		webgpu: wgsl.webgpu,
		wgslModules: wgsl.modules,
		wgslSkipped: wgsl.skipped,
		failures,
	};
});
