// The shape of a species' targets file, `tools/lib/plant-review/targets/<species>.json`: what
// `bun run plants:targets` measures from the species' reference folder for the plant generator to
// be driven by. A measured figure is a number or null, and every null has its reason in the
// `missing` list beside it and in the file's `nulls` list. Stated facts stand apart under `stated`.
import type { StatedFacts } from './facts.ts';
import type { PieceFigures } from './piece.ts';
import type { LimbFigures } from './shape.ts';
import type { PieceTurn, TurnFigures } from './turn.ts';
import type { ViewFigures } from './whole.ts';

/** The version of the file's shape. A change that moves or renames a figure raises it. */
export const TARGETS_SCHEMA = 1;

/** One still of the whole plant: its figures, or null with the reason under `missing.figures`. */
export interface WholeStill {
	readonly file: string;
	readonly figures: ViewFigures | null;
	readonly missing: Readonly<Record<string, string>>;
}

/** One figure across the pictures: how far the secondary views stand from the primary individual. */
export interface SpreadRow {
	/** The figure's name, as `turn.stats` names it. */
	readonly figure: string;
	/** The primary still's value. */
	readonly primary: number | null;
	/**
	 * Whether the primary still's value lies outside its own turning video's range. The video starts
	 * from the still, so a value outside the range means one of the two outlines is at fault.
	 */
	readonly primaryOutsideTurn: boolean;
	/** The primary individual's range round its turning video. */
	readonly turn: {
		readonly min: number;
		readonly low: number;
		readonly median: number;
		readonly high: number;
		readonly max: number;
	} | null;
	/** Each secondary view's value, by file. */
	readonly secondary: Readonly<Record<string, number | null>>;
	/**
	 * The largest distance of a secondary view from the primary still, over the primary still's
	 * value. Null where either side is missing or the primary value is 0.
	 */
	readonly largest: number | null;
	/** The secondary views whose value lies outside the turning video's range. */
	readonly outsideTurn: readonly string[];
}

/** One picture of the plant's wood and what it gives. */
export interface WoodView {
	readonly file: string;
	/** The limbs that show apart at the first fork, or null with the reason under `missing.limbs`. */
	readonly limbs: LimbFigures | null;
	readonly missing: Readonly<Record<string, string>>;
}

/** One still of a branch piece. */
export interface PieceStill {
	readonly file: string;
	/** The review view the still is sorted into: a branch, a sub-branch, a cluster or twigs. */
	readonly view: string;
	/** Whether the still shows the piece on the plant rather than cut and stood in a studio. */
	readonly inPlace: boolean;
	readonly figures: PieceFigures | null;
	readonly missing: Readonly<Record<string, string>>;
}

/** A species' targets. */
export interface SpeciesTargets {
	readonly schema: typeof TARGETS_SCHEMA;
	readonly species: string;
	/** How the figures were measured. */
	readonly source: {
		readonly command: string;
		/** The reference folder's own name. */
		readonly references: string;
		/** The width in pixels that every picture and frame is measured at. */
		readonly workWidth: number;
		/** The notch depth of the headline lump count, a share of the crown's size. */
		readonly lobeDepth: number;
		/** The upper edges of the hole size classes, as shares of the crown's width. */
		readonly holeClasses: readonly number[];
		/**
		 * Breast height as a share of the plant's height, from the stated height's middle, or null
		 * with the reason under `missing.breastHeight`.
		 */
		readonly breastHeight: number | null;
		readonly missing: Readonly<Record<string, string>>;
	};
	/** What the fact sheet states, never measured, or null with the reason under `missing.stated`. */
	readonly stated: StatedFacts | null;
	readonly whole: {
		/** The primary individual: picture 01 and the whole plant's turning video. */
		readonly primary: {
			readonly still: WholeStill | null;
			readonly turn: TurnFigures | null;
			readonly missing: Readonly<Record<string, string>>;
		};
		/** Other individuals of the same habit: the whole views numbered up to 18. */
		readonly secondary: readonly WholeStill[];
		/** Whole views numbered above 18: other forms, ages and seasons. They join no spread. */
		readonly others: readonly WholeStill[];
		/** How far the secondary views stand from the primary individual, figure by figure. */
		readonly spread: readonly SpreadRow[];
	};
	/**
	 * The close pictures of the wood and what each gives. A whole view's limb count stands with its
	 * other figures, under `whole`.
	 */
	readonly wood: { readonly views: readonly WoodView[] };
	/** The branch pieces: their stills and their turning videos. */
	readonly pieces: {
		readonly stills: readonly PieceStill[];
		readonly turns: readonly PieceTurn[];
	};
	/** Every null figure of the file with its reason, by its path. */
	readonly nulls: readonly { readonly path: string; readonly reason: string }[];
	/** Why a whole section is missing, by its name. */
	readonly missing: Readonly<Record<string, string>>;
}

/**
 * A targets file's text. Lists of plain values stand on one line each, so a profile reads as a row,
 * and the same targets always give the same bytes.
 */
export function targetsText(targets: SpeciesTargets): string {
	const plain = (value: unknown): boolean => value === null || typeof value !== 'object';
	const write = (value: unknown, indent: string): string => {
		if (Array.isArray(value)) {
			if (value.length === 0) return '[]';
			if (value.every(plain)) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
			const inner = `${indent}\t`;
			return `[\n${value.map((v) => `${inner}${write(v, inner)}`).join(',\n')}\n${indent}]`;
		}
		if (value !== null && typeof value === 'object') {
			const entries = Object.entries(value as Record<string, unknown>).filter(
				([, v]) => v !== undefined,
			);
			if (entries.length === 0) return '{}';
			const inner = `${indent}\t`;
			return `{\n${entries
				.map(([key, v]) => `${inner}${JSON.stringify(key)}: ${write(v, inner)}`)
				.join(',\n')}\n${indent}}`;
		}
		return JSON.stringify(value);
	};
	return `${write(targets, '')}\n`;
}

/**
 * Every null figure under a value with its reason: each `missing` list's entries, by the path of
 * the object that holds the list.
 */
export function nullsOf(value: unknown, path = ''): { path: string; reason: string }[] {
	if (value === null || typeof value !== 'object') return [];
	if (Array.isArray(value))
		return value.flatMap((item, index) => {
			const name =
				item !== null && typeof item === 'object' && typeof item.file === 'string'
					? item.file
					: item !== null && typeof item === 'object' && typeof item.video === 'string'
						? item.video
						: String(index);
			return nullsOf(item, `${path}[${name}]`);
		});
	const found: { path: string; reason: string }[] = [];
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		const here = path === '' ? key : `${path}.${key}`;
		if (key === 'missing' && item !== null && typeof item === 'object')
			for (const [name, reason] of Object.entries(item as Record<string, string>))
				found.push({ path: path === '' ? name : `${path}.${name}`, reason });
		else if (key !== 'nulls') found.push(...nullsOf(item, here));
	}
	return found;
}
