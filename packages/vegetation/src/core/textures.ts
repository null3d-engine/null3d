// The texture files of a species and the manifest that the textures tool writes beside them. The
// files ship in the separate `@null3d/vegetation-textures` package, one folder per species, as
// ETC1S KTX2 in a full set and a half set. A page loads them the first time it prepares the species.
// The CPU never reads KTX2 texels: the kit, the card bake and the far bake read the manifest's
// contour, means and profiles.
import type { Species } from './record';
import type { Rgb, Vec2 } from './types';

/** The bark colour of a species that neither measures its bark nor gives it a colour. */
export const STAND_IN_BARK: Rgb = [0.2, 0.16, 0.12];

/**
 * The colour a species' grown bark draws in where no bark texture draws: its first zone's measured
 * mean times that zone's tint. A species with no measured bark, such as a stand-in, gives its
 * colour in the tint itself; one with neither takes the stand-in colour.
 *
 * @param record The species record.
 * @param manifest The species' texture manifest.
 * @returns The colour.
 */
export function barkColourOf(record: Species, manifest: TextureManifest): Rgb {
	const zone = record.bark?.zones[0];
	const measured = zone ? manifest.bark?.layers[zone.layer]?.mean : undefined;
	const tint = zone?.tint;
	if (!measured) return tint ?? STAND_IN_BARK;
	return tint ? [measured[0] * tint[0], measured[1] * tint[1], measured[2] * tint[2]] : measured;
}

/**
 * A species' texture files: the manifest, and the URLs of both sets.
 *
 * @category api/vegetation
 */
export interface SpeciesTextureFiles {
	/** What the textures tool measured and wrote. */
	readonly manifest: TextureManifest;
	/** 1024 texels a side (young bark 512): every preset but Low. */
	readonly full: TextureSet;
	/** 512 texels a side (young bark 256): the Low preset. */
	readonly half: TextureSet;
}

/**
 * One set of separate KTX2 files, all ETC1S. A plant with no leaves or no bark omits them.
 *
 * @category api/vegetation
 */
export interface TextureSet {
	/** The leaf colour array: upper and lower faces, with coverage in alpha. */
	readonly leafColor?: URL;
	/** The leaf normal array of one layer: the blade's relief. */
	readonly leafNormal?: URL;
	/** The bark colour array: one layer per bark zone. */
	readonly barkColor?: URL;
	/** The bark normal array: one layer per bark zone. */
	readonly barkNormal?: URL;
	/** Young bark colour, for thin wood and shoot stems. */
	readonly youngColor?: URL;
	/** Young bark normal. */
	readonly youngNormal?: URL;
}

/**
 * The manifest that the textures tool writes beside a species' files: its inputs, its outputs and
 * the figures it measured.
 *
 * @category api/vegetation
 */
export interface TextureManifest {
	/** The manifest's format. */
	readonly format: 1;
	/** The species folder the files belong to. */
	readonly species: string;
	/**
	 * The reference set the files were made from: its commit, or `local` for files read from a
	 * folder outside it, and each source file's name, hash and the generation job that made it.
	 */
	readonly source: {
		readonly repository: 'null3d-engine/plant-references';
		readonly commit: string;
		readonly files: readonly {
			readonly name: string;
			readonly sha256: string;
			readonly job?: string;
		}[];
	};
	/** The tool's version and the encoder it ran. */
	readonly tool: { readonly version: string; readonly encoder: string };
	/** The leaf textures' figures, when the species has leaves. */
	readonly leaf?: TextureManifestLeaf;
	/** The bark textures' figures, when the species has bark. */
	readonly bark?: TextureManifestBark;
	/** Every file of both sets, so a test can check the files and the budget without the references. */
	readonly outputs: readonly {
		readonly file: string;
		readonly sha256: string;
		readonly bytes: number;
	}[];
}

/**
 * What the textures tool measured of a species' leaf.
 *
 * @category api/vegetation
 */
export interface TextureManifestLeaf {
	/** Texels per side. */
	readonly size: number;
	/** The layers in order. */
	readonly layers: readonly ('upper' | 'lower')[];
	/** Blade length in the texture, as a share of the texture's height. */
	readonly length: number;
	/** Petiole base, blade base and tip in texture coordinates; the midrib runs up the middle. */
	readonly frame: { readonly petiole: Vec2; readonly base: Vec2; readonly tip: Vec2 };
	/** The blade's contour in texture coordinates, 24 to 64 points, counter-clockwise, x then y. */
	readonly outline: readonly number[];
	/** Linear mean colour of covered texels, per face; the shader divides by these. */
	readonly mean: { readonly upper: Rgb; readonly lower: Rgb };
	/**
	 * How the shader reads thickness and the vein mask from the colour's linear luminance:
	 * `luminance` is the upper face's median over the blade, and the vein mask is
	 * clamp((texel luminance − luminance) × contrast, 0, 1), which reaches 1 at the 98th percentile.
	 */
	readonly veins: { readonly luminance: number; readonly contrast: number };
	/** Luminance from base to tip in 8 bands, per face, for the CPU card bake. */
	readonly profile: { readonly upper: readonly number[]; readonly lower: readonly number[] };
	/** Share of the texture the blade covers. */
	readonly coverage: number;
}

/**
 * What the textures tool measured of a species' bark.
 *
 * @category api/vegetation
 */
export interface TextureManifestBark {
	/** Texels per side. */
	readonly size: number;
	/** One entry per bark zone's layer. */
	readonly layers: readonly {
		/** The zone's name. */
		readonly name: string;
		/** Metres the tile covers around and along. */
		readonly tile: Vec2;
		/** The layer's linear mean colour. */
		readonly mean: Rgb;
		/**
		 * The shader reads height from the colour's luminance (furrows are dark). This maps luminance
		 * to metres: height is luminance less the offset, times the depth.
		 */
		readonly height: { readonly offset: number; readonly depth: number };
	}[];
	/** The young bark tile, metres around and along, and its mean. */
	readonly young: { readonly tile: Vec2; readonly mean: Rgb };
}

/**
 * The texture files of a species that ships none yet: a manifest with no leaf, no bark and no
 * outputs, and two empty sets. The stand-in stages draw such a species in flat colours.
 *
 * @param species The species' folder name.
 * @returns The empty files.
 * @category api/vegetation
 */
export function noTextureFiles(species: string): SpeciesTextureFiles {
	return {
		manifest: {
			format: 1,
			species,
			source: { repository: 'null3d-engine/plant-references', commit: '', files: [] },
			tool: { version: '', encoder: '' },
			outputs: [],
		},
		full: {},
		half: {},
	};
}
