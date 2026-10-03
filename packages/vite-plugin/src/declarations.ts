// The declarations that the plugin writes beside the `.wgsl` files that a project's modules import.
// TypeScript cannot read WGSL, so the client types give a `.wgsl` import a general type, which takes
// any uniform name. A declaration beside the file, `glow.wgsl.d.ts` beside `glow.wgsl`, takes its
// place: it names the kind of shader and the type of each uniform of `struct Uniforms`, so that
// `materials.shader` checks the names and values that its `uniforms` option and `set()` get.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { CompiledWgsl } from './shader-types.ts';

/** A name that TypeScript takes as a property name without quotes. */
const PLAIN_NAME = /^[A-Za-z_$][\w$]*$/;

/** The path of the declaration of a `.wgsl` file. */
export function declarationPath(file: string): string {
	return `${file}.d.ts`;
}

/** The type of a compiled shader, as TypeScript code: its kind, and its uniforms by name. */
function shaderType(shader: CompiledWgsl): string {
	if (shader.kind === 'shader') return 'CompiledShader';
	const fields = shader.uniforms.map(({ name, type }) => {
		const key = PLAIN_NAME.test(name) ? name : JSON.stringify(name);
		return `\treadonly ${key}: '${type}';\n`;
	});
	const record = fields.length > 0 ? `{\n${fields.join('')}}` : 'Record<never, never>';
	return `CompiledMaterial<${record}>`;
}

/** The declaration of a compiled `.wgsl` file, which TypeScript reads for imports of the file. */
export function wgslDeclaration(file: string, shader: CompiledWgsl): string {
	const kind = shader.kind === 'shader' ? 'CompiledShader' : 'CompiledMaterial';
	return [
		`// The types of ${basename(file)}, which the null3D Vite plugin writes when it compiles the file.`,
		'// Edit the WGSL, not this file.',
		`import type { ${kind} } from '@null3d/vite-plugin';`,
		'',
		`declare const shader: ${shaderType(shader)};`,
		'export default shader;',
		'',
	].join('\n');
}

/**
 * Writes the declaration of a compiled `.wgsl` file beside it, unless the file there already holds
 * it. An unchanged declaration is left alone, so that editors and file watchers see no change.
 */
export function writeWgslDeclaration(file: string, shader: CompiledWgsl): void {
	const path = declarationPath(file);
	const text = wgslDeclaration(file, shader);
	let current: string | undefined;
	try {
		current = readFileSync(path, 'utf8');
	} catch {
		current = undefined;
	}
	if (current !== text) writeFileSync(path, text);
}
