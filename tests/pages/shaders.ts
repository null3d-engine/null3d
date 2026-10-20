// Compiles every variant of the generated shader modules in this browser. Each GLSL program must
// compile and link in WebGL2, and every uniform block and texture that the reflection names must
// be declared in its source. The ones that the driver removed, because the program never reads
// them, are listed apart. Each WGSL module must compile in WebGPU when the browser has it,
// with the device feature `shader-f16` for the modules at half precision where the adapter has it.
// Failures carry the browser's info logs. Programs that link at the second try after Safari's random
// Metal fault are listed apart. The result gives the time the GLSL programs took.
// With `?part=k&parts=n`, the page downloads and checks only part k of n of the shader builds, so
// that several pages can share the work. With `?set=`, it checks only one set of them, such as the
// builds without the coat and sheen bit, a sample of those with it, the builds of the features that
// load on first use, or a sample of those.
import { everyShader } from '@null3d/engine/internal';
import { progress, run } from './lib/result';
import { checkGlslPrograms, checkWgslModules, type ShaderFailure } from './lib/shader-checks';
import {
	glslProgramsOf,
	inShaderSet,
	SHADER_SETS,
	type ShaderSet,
	wgslModulesOf,
} from './lib/shader-list';

const params = new URLSearchParams(location.search);
const part = Number(params.get('part') ?? 1);
const parts = Number(params.get('parts') ?? 1);
const set = (params.get('set') ?? 'all') as ShaderSet;

run('shaders', async () => {
	if (!Number.isInteger(part) || !Number.isInteger(parts) || part < 1 || part > parts)
		throw new Error(`no part ${params.get('part')} of ${params.get('parts')}`);
	if (!SHADER_SETS.includes(set)) throw new Error(`no set of shaders named ${set}`);
	const inSet = ([name]: readonly [string, unknown]) => inShaderSet(name, set);
	// This part's share of the shaders of the main module and of the device modules, kept to the
	// set that the page checks. The trail notes the download, which can outlast the compiles.
	progress(`downloading part ${part} of ${parts} of the shader modules`);
	const shaders = await everyShader(part, parts);
	progress('downloaded the shader modules');
	const failures: ShaderFailure[] = [];
	const glslStart = performance.now();
	const glsl = await checkGlslPrograms(glslProgramsOf(shaders).filter(inSet), failures);
	const glslSeconds = Math.round(performance.now() - glslStart) / 1000;
	const modules = wgslModulesOf(shaders).filter(inSet);
	const wgsl = await checkWgslModules(modules, failures);
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
		// What the part's share holds, so a part whose modules all need 16-bit floats reads as
		// checked on a GPU that has none rather than as one that drew nothing.
		wgslExpected: modules.length,
		failures,
	};
});
