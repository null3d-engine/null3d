// The files of custom materials' builds. A custom material builds into every variant of the
// engine's standard material, 80 builds, of which one device draws with 8 on WebGPU and 16 on
// WebGL2. So the plugin writes the builds into one file for each GPU path and each value of the
// permutation bits that a device fixes, and the material's value in the module keeps only the
// files' addresses. The thread that draws downloads its device's file when the material first
// reaches it. The materials that the plugin compiles together, those of one `.wgsl` file or of one
// script's tagged literals, share their files, and each file writes once each source and each
// paragraph that their builds share. A production build writes the files beside the bundle, and
// the dev server serves them from memory. A hot update on the dev server names new files too.
import { createHash } from 'node:crypto';
import type { MaterialFile, ShaderCompiler } from './shader-compiler.ts';
import type { BuiltWgsl, CompiledWgsl } from './shader-types.ts';

/** The folder under the dev server's base that serves the files of custom materials. */
export const MATERIAL_FOLDER = 'null3d-materials';

/** A compiled shader of a module, with the key of its hot updates on the dev server. */
export interface ModuleShader {
	readonly shader: BuiltWgsl;
	readonly key?: string | undefined;
}

/** The files of the materials of a list, with the address of each file as `address` gives it. */
interface FilesOf<T> {
	readonly wgsl: Record<number, T>;
	readonly glsl: Record<number, T>;
}

/**
 * Writes the files of the custom materials among `shaders`, and returns each file's address as
 * `address` gives it, by GPU path and fixed bits. Every material of the list is in every file.
 */
async function writeFiles<T>(
	shaders: readonly ModuleShader[],
	compiler: ShaderCompiler,
	address: (file: MaterialFile) => T,
): Promise<FilesOf<T>> {
	const files: FilesOf<T> = { wgsl: {}, glsl: {} };
	const variants = shaders.flatMap(({ shader }) =>
		shader.kind === 'material' ? [shader.variants] : [],
	);
	if (variants.length === 0) return files;
	const result = await compiler.files(variants);
	if (!result.ok)
		throw new Error(
			`null3D could not write the files of custom materials' builds: ${result.problems.map((problem) => problem.message).join(' ')}`,
		);
	for (const file of result.output) files[file.target][file.bits] = address(file);
	return files;
}

/**
 * Each shader of `shaders` as its module's value: a custom material with its builds left out and
 * its files in their place, its key for hot updates, and any other shader whole, as its builds
 * are few. `place` gives the value of a material's files from its place in each file's list.
 */
function valuesOf<T>(
	shaders: readonly ModuleShader[],
	place: (index: number) => T,
): Record<string, unknown>[] {
	let index = 0;
	return shaders.map(({ shader, key }) => {
		const hot = key === undefined ? {} : { hot: key };
		if (shader.kind !== 'material') return { ...shader, ...hot };
		const { variants: _, ...rest } = shader;
		return { ...rest, ...hot, files: place(index++) };
	});
}

/**
 * The code of each shader's value in its module, in order. A custom material's value names the
 * files of its builds by the JavaScript expressions that `address` gives for them.
 */
export async function shaderValues(
	shaders: readonly ModuleShader[],
	compiler: ShaderCompiler,
	address: (file: MaterialFile) => string,
): Promise<string[]> {
	const files = await writeFiles(shaders, compiler, address);
	const code = (addresses: Record<number, string>) =>
		`{${Object.entries(addresses)
			.map(([bits, url]) => `${bits}: ${url}`)
			.join(', ')}}`;
	const placed = valuesOf(
		shaders,
		(index) => `{"index":${index},"wgsl":${code(files.wgsl)},"glsl":${code(files.glsl)}}`,
	);
	// A material's files are code, not JSON, so they go in after the rest of its value.
	return placed.map((value) => {
		if (!('files' in value)) return `(${JSON.stringify(value)})`;
		const { files: place, ...rest } = value;
		return `(${JSON.stringify(rest).slice(0, -1)},"files":${place}})`;
	});
}

/**
 * Each shader of a hot update as the page receives it: a custom material with the addresses of
 * new files, which `address` gives, in place of its builds.
 */
export async function hotShaders(
	shaders: readonly ModuleShader[],
	compiler: ShaderCompiler,
	address: (file: MaterialFile) => string,
): Promise<CompiledWgsl[]> {
	const files = await writeFiles(shaders, compiler, address);
	return valuesOf(shaders, (index) => ({ index, ...files })) as unknown as CompiledWgsl[];
}

/** The name under which the dev server serves a file: its content's hash, then its own name. */
export function devFileName(file: MaterialFile): string {
	const hash = createHash('sha256').update(file.source).digest('hex').slice(0, 16);
	return `${hash}-${file.name}.js`;
}
