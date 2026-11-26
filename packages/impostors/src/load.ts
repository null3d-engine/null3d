// Loads the files of a baked impostor atlas, which `bunx @null3d/cli assets impostor` writes, into
// the two textures and the figures that `createImpostors` takes from a bake (atlas-file.ts).

import type { Assets, Texture } from '@null3d/engine';
import { checkImpostorFile } from './atlas-file';
import type { OctahedralAtlas } from './octahedral';

/**
 * A baked atlas that `loadImpostorAtlas` loaded: the fields that `createImpostors` takes from a
 * bake, so a sketch spreads it into the options.
 *
 * @category api/impostors
 */
export interface LoadedImpostorAtlas {
	/** The color atlas, in sRGB, with no mipmaps. */
	readonly color: Texture;
	/** The surface atlas, linear, with no mipmaps. */
	readonly surface: Texture;
	/** The cells across and down. */
	readonly atlas: OctahedralAtlas;
	/** The card's width and height at scale 1. */
	readonly size: readonly [number, number];
	/** How much taller a view's picture is than the card's height. */
	readonly room: number;
	/** The object's depth along a view, in world units. */
	readonly depth: number;
}

/**
 * Loads an impostor atlas file that `bunx @null3d/cli assets impostor` wrote, with its two images.
 *
 * The images load from the JSON file's folder. The result holds the fields that `createImpostors`
 * takes from a bake:
 *
 * ```ts
 * const pine = await loadImpostorAtlas(assets, 'pine-impostor.json');
 * const trees = createImpostors({ scene, materials, geometry }, { ...pine, positions, alphaMode: 'mask' });
 * ```
 *
 * @param assets The sketch's asset loader.
 * @param url The JSON file's address.
 * @returns The two atlases and the bake's figures.
 * @throws {Error} When the file is not an impostor atlas file of a version this package reads.
 * @category api/impostors
 */
export async function loadImpostorAtlas(
	assets: Pick<Assets, 'loadJson' | 'loadTexture'>,
	url: string | URL,
): Promise<LoadedImpostorAtlas> {
	const file = checkImpostorFile(await assets.loadJson<unknown>(url), String(url));
	const [color, surface] = await Promise.all([
		assets.loadTexture(siblingUrl(url, file.color), { colorSpace: 'srgb', mipmaps: false }),
		assets.loadTexture(siblingUrl(url, file.surface), { colorSpace: 'linear', mipmaps: false }),
	]);
	return {
		color,
		surface,
		atlas: file.atlas,
		size: file.size,
		room: file.room,
		depth: file.depth,
	};
}

/** The address of `name` in the folder of `url`. A relative `url` stays relative to the page. */
function siblingUrl(url: string | URL, name: string): string {
	const text = String(url);
	try {
		return new URL(name, text).href;
	} catch {
		const path = text.split(/[?#]/, 1)[0] as string;
		return path.slice(0, path.lastIndexOf('/') + 1) + name;
	}
}
