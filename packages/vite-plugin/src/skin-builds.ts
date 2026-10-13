// Custom materials' WebGPU builds that skin in the vertex shader load on first use, as the engine's
// own skinning builds do: the engine imports them when a material first draws a skinned mesh on
// WebGPU. So a module carries a material's other builds, and a function that imports a virtual
// module of the plugin's, named by a hash of the skin builds. A page without such a mesh never
// downloads them, and a build of the project puts them in a file of their own.
import { createHash } from 'node:crypto';
import { ShaderPack } from './pack.ts';
import type { CompiledWgsl, ShaderVariant } from './shader-types.ts';

/** The prefix of the virtual modules that hold a material's skin builds. */
export const SKIN_BUILDS = 'virtual:null3d/skin/';

/** The name or module id of a virtual module of skin builds, as Vite's hook filters match them. */
export const SKIN_BUILDS_ADDRESS = /^\0?virtual:null3d\/skin\/[0-9a-f]+$/;

/** The skin builds of the materials that the plugin compiled, by the hash that names their module. */
export class SkinBuilds {
	private readonly builds = new Map<string, Readonly<Record<string, ShaderVariant>>>();

	/**
	 * The JavaScript expression of `shader` in a module that `pack` packs, as `ShaderPack.value`
	 * gives it. A material's skin builds go to their own module instead.
	 */
	value(pack: ShaderPack, shader: CompiledWgsl, hot?: string): string {
		if (shader.kind !== 'material' || !shader.skinVariants) return pack.value(shader, hot);
		const { skinVariants, ...rest } = shader;
		if (Object.keys(skinVariants).length === 0) return pack.value(rest, hot);
		const json = JSON.stringify(skinVariants);
		const hash = createHash('sha256').update(json).digest('hex').slice(0, 16);
		this.builds.set(hash, skinVariants);
		return pack.value(rest, hot, `${SKIN_BUILDS}${hash}`);
	}

	/** The code of the virtual module `id`, or undefined for a module that this plugin did not name. */
	module(id: string): string | undefined {
		const variants = this.builds.get(id.slice(id.lastIndexOf('/') + 1));
		if (!variants) return undefined;
		const pack = new ShaderPack();
		return `export default ${pack.value({ variants })};\n${pack.unpacker()}`;
	}
}
