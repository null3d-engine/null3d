// The declarations that the plugin writes beside the `.wgsl` files that a project's modules import.
// TypeScript cannot read WGSL, so the client types give a `.wgsl` import a general type, which takes
// any uniform name. A declaration beside the file, `glow.wgsl.d.ts` beside `glow.wgsl`, takes its
// place: it names the kind of shader, the type of each uniform of `struct Uniforms` and the name
// of each texture, so that `materials.shader` checks the names and values that its `uniforms` and
// `textures` options and `set()` get, and `post.addEffect` and `post.setEffectUniform` check an
// effect's.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { BuiltWgsl } from './shader-types.ts';

/** The longest line that a formatter keeps whole. */
const LINE_WIDTH = 100;

/** A name that TypeScript takes as a property name without quotes. */
const PLAIN_NAME = /^[A-Za-z_$][\w$]*$/;

/** The type that each kind of compiled WGSL has. */
const KIND_TYPES: Readonly<Record<BuiltWgsl['kind'], string>> = {
	shader: 'CompiledShader',
	material: 'CompiledMaterial',
	effect: 'CompiledEffect',
	toneCurve: 'CompiledToneCurve',
};

/** The path of the declaration of a `.wgsl` file. */
export function declarationPath(file: string): string {
	return `${file}.d.ts`;
}

/**
 * The type of a compiled shader, as TypeScript code: its kind, its uniforms by name, and the names
 * of its textures.
 */
function shaderType(shader: BuiltWgsl): string {
	if (shader.kind === 'shader') return 'CompiledShader';
	if (shader.kind === 'toneCurve') return 'CompiledToneCurve';
	const fields = shader.uniforms.map(({ name, type }) => {
		const key = PLAIN_NAME.test(name) ? name : JSON.stringify(name);
		return `\t\treadonly ${key}: '${type}';\n`;
	});
	if (shader.kind === 'effect') {
		if (fields.length === 0) return 'CompiledEffect<Record<never, never>>';
		return `CompiledEffect<{\n${fields.map((field) => field.slice(1)).join('')}}>`;
	}
	// WGSL names hold no quotes, and the layout is the one that Biome and Prettier give, so a
	// project's formatter leaves the file alone.
	const names = shader.textures.map(({ name }) => `'${name}'`).join(' | ') || 'never';
	const short = `CompiledMaterial<Record<never, never>, ${names}>`;
	if (fields.length === 0 && `declare const shader: ${short};`.length <= LINE_WIDTH) return short;
	const record = fields.length > 0 ? `{\n${fields.join('')}\t}` : 'Record<never, never>';
	return `CompiledMaterial<\n\t${record},\n\t${names}\n>`;
}

/** The declaration of a compiled `.wgsl` file, which TypeScript reads for imports of the file. */
export function wgslDeclaration(file: string, shader: BuiltWgsl): string {
	const kind = KIND_TYPES[shader.kind];
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
export function writeWgslDeclaration(file: string, shader: BuiltWgsl): void {
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
