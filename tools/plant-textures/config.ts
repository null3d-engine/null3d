// A species' texture inputs: `source.json` in its texture folder, written by hand and kept in git.
// It names the slots that feed each layer and the numbers the tool cannot measure, such as the
// metres a bark tile covers. Every field but the slots and the metres has a default here.
import { existsSync, readFileSync } from 'node:fs';

/** How the low-frequency shading of a picture is divided out. */
export interface DelightConfig {
	/** The blur's radius as a share of the texture's side. */
	readonly radius: number;
	/** 0 keeps the picture's shading, 1 removes all of it. */
	readonly strength: number;
}

/** A leaf picture's stalk and tip, in its own texels. */
export interface LeafFrame {
	readonly petiole: readonly [number, number];
	readonly tip: readonly [number, number];
}

/** The leaf textures' inputs. */
export interface LeafConfig {
	/** The slots of the upper and lower faces: 24 and 25 by the reference brief. */
	readonly upper: number;
	readonly lower: number;
	/**
	 * The rectangle each face is cut from, as left, top, width and height in source texels: a
	 * compound leaf's picture holds its whole blade, and the leaflet that the mesh draws takes its
	 * own part of it. The whole picture where none is given.
	 */
	readonly crop?: readonly [number, number, number, number];
	/**
	 * The lower face's own rectangle, where its picture is not the upper picture's mirror: a genus
	 * whose underside photograph is another shoot needs its own part of the frame, or the face's
	 * outline would widen the leaf. `crop` where none is given.
	 */
	readonly lowerCrop?: readonly [number, number, number, number];
	/** Alpha bytes below `floor` are cleared; at or above `solid` the leaf is fully covered. */
	readonly alpha: { readonly floor: number; readonly solid: number };
	/**
	 * The dark gaps a compound leaf's picture keeps between its lobes or pinnules, which its cut-out
	 * counts as leaf: a covered texel whose linear luminance is under `luminance` is cleared, fading
	 * back to its coverage over `ramp` times that luminance above it. Absent, no texel is cleared
	 * for its darkness.
	 */
	readonly gaps?: { readonly luminance: number; readonly ramp: number };
	/**
	 * True to turn the lower face's picture left for right, false to keep it as drawn; by default the
	 * tool takes whichever fits the upper face's outline better.
	 */
	readonly mirrorLower?: boolean;
	/** Texels in from the edge where the leaf's own colour starts; the rest is bled from it. */
	readonly erode: number;
	/** The share of the canvas kept empty round the leaf on its longer side. */
	readonly margin: number;
	/**
	 * The stalk's bottom end and the tip, in the upper face's texels after any crop, where the
	 * found frame is wrong. A leaf whose tip tapers to a bare point narrower than its stalk reads
	 * as a stalk, so a species whose picture does that names the frame here rather than taking the
	 * found one.
	 */
	readonly frame?: LeafFrame;
	/** The same for the lower face, in its own texels after the same crop. */
	readonly lowerFrame?: LeafFrame;
	readonly delight: DelightConfig;
	/**
	 * The blade's relief: the weights of the sunken veins and of the puckering between them, and
	 * its depth as a share of the canvas's side, which sets the normal map's slopes.
	 */
	readonly relief: { readonly veins: number; readonly pucker: number; readonly depth: number };
}

/** One bark layer's inputs. */
export interface BarkLayerConfig {
	/** The zone's name, which the manifest records. */
	readonly name: string;
	/** The slot of its picture: 26 for the trunk, 27 for a second zone, 28 for young bark. */
	readonly slot: number;
	/** The square of the source the tile is made from: left, top and side in source texels. */
	readonly crop?: readonly [number, number, number];
	/** Metres the tile covers around and along the stem. */
	readonly tile: readonly [number, number];
	/** Metres from the 2nd to the 98th percentile of the height: the depth of the furrows. */
	readonly depth: number;
	/** A factor on the normal map's slopes. */
	readonly normal: number;
	/**
	 * Texels of blur on the picture's luminance before the height field reads it, at a tile of
	 * 1024: it keeps the broad plates and drops the photograph's fine cracks.
	 */
	readonly smooth: number;
	readonly delight: DelightConfig;
	/**
	 * A linear colour, multiplied channel by channel into the layer's baked colour, which steers
	 * the layer toward the species' own tone. It reaches the colour alone, so the relief keeps the
	 * picture's shapes, and the manifest's mean records the tinted tile. Absent, the layer bakes as
	 * it always has.
	 */
	readonly tint?: readonly [number, number, number];
}

/** The bark textures' inputs. */
export interface BarkConfig {
	/** One layer per bark zone, the trunk's first. */
	readonly zones: readonly BarkLayerConfig[];
	readonly young: BarkLayerConfig;
}

/** The output files, each of which may take its own ETC1S quality. */
export const FILES = [
	'leaf-color',
	'leaf-normal',
	'bark-color',
	'bark-normal',
	'young-color',
	'young-normal',
] as const;

/** One output file's name, less the set's suffix and the extension. */
export type FileName = (typeof FILES)[number];

/** A species' texture inputs. */
export interface SourceConfig {
	/** The class of the owner's caps the download must stay under: trees, palms or ground plants. */
	readonly caps: 'tree' | 'palm' | 'ground';
	readonly leaf?: LeafConfig;
	readonly bark?: BarkConfig;
	/** ETC1S quality from 1 to 255 per file; 128, the encoder's default, where none is given. */
	readonly quality: Readonly<Record<FileName, number>>;
}

/** ETC1S's default quality: the basisu command's. */
export const DEFAULT_QUALITY = 128;

/** The leaf inputs that a species's `source.json` does not set. */
export const LEAF_DEFAULTS: LeafConfig = {
	upper: 24,
	lower: 25,
	alpha: { floor: 16, solid: 240 },
	erode: 1,
	margin: 0.02,
	delight: { radius: 0.06, strength: 1 },
	relief: { veins: 1, pucker: 0.5, depth: 0.002 },
};

const ZONE_DEFAULTS = { normal: 1, smooth: 0, delight: { radius: 0.2, strength: 1 } };

/** Reads a species' `source.json`, with the defaults filled in. */
export function readConfig(file: string): SourceConfig {
	if (!existsSync(file))
		throw new Error(
			`${file} does not exist: write the species' texture inputs there first (its fields are in tools/plant-textures/config.ts)`,
		);
	const raw = JSON.parse(readFileSync(file, 'utf8'));
	const quality = Object.fromEntries(
		FILES.map((name) => [name, raw.quality?.[name] ?? DEFAULT_QUALITY]),
	) as Record<FileName, number>;
	const zone = (z: Record<string, unknown>) => {
		const tint = z.tint as readonly unknown[] | undefined;
		if (
			tint !== undefined &&
			(!Array.isArray(tint) ||
				tint.length !== 3 ||
				tint.some((v) => typeof v !== 'number' || !(v >= 0)))
		)
			throw new Error(`a bark tint is three linear numbers from 0 up, not ${JSON.stringify(tint)}`);
		return {
			...ZONE_DEFAULTS,
			...z,
			delight: { ...ZONE_DEFAULTS.delight, ...(z.delight as object) },
		} as BarkLayerConfig;
	};
	return {
		caps: raw.caps ?? 'tree',
		...(raw.leaf
			? {
					leaf: {
						...LEAF_DEFAULTS,
						...raw.leaf,
						alpha: { ...LEAF_DEFAULTS.alpha, ...raw.leaf.alpha },
						delight: { ...LEAF_DEFAULTS.delight, ...raw.leaf.delight },
						relief: { ...LEAF_DEFAULTS.relief, ...raw.leaf.relief },
					},
				}
			: {}),
		...(raw.bark ? { bark: { zones: raw.bark.zones.map(zone), young: zone(raw.bark.young) } } : {}),
		quality,
	};
}
