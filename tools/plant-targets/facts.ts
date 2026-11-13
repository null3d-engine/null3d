// A species' written fact sheet, read into fields: the figures and words that its reference
// pictures were made from. They are what the sheet states, never what a picture measures, and the
// targets file keeps them apart from the measured figures. A field the sheet does not state in
// words this reader knows is null, with the reason beside it.

/** A stated range, lowest first; a single stated value is both ends. */
export type StatedRange = readonly [number, number];

/** The fields read from a fact sheet. */
export interface StatedFacts {
	/** The plant's names, as the sheet gives them. */
	readonly names: string | null;
	/** The plant's height in metres. */
	readonly heightMetres: StatedRange | null;
	/** The height of the flowering stems in metres, where the sheet gives one beside the leaves'. */
	readonly flowerStemMetres: StatedRange | null;
	/** The plant's spread in metres. */
	readonly spreadMetres: StatedRange | null;
	/** The plant's width over its height, as the sheet's own ratio states it. */
	readonly widthToHeight: StatedRange | null;
	/** The crown's share of the height. */
	readonly crownShare: StatedRange | null;
	/** The clear trunk's share of the height. */
	readonly clearTrunkShare: StatedRange | null;
	/** The trunk's thickness in metres, with the sheet's words for where it is taken. */
	readonly trunkMetres: { readonly range: StatedRange; readonly words: string } | null;
	/** The sheet's words for how many stems the plant has. */
	readonly stems: string | null;
	/** A leaf's length and width in centimetres: the first leaf, frond, blade or needle described. */
	readonly leafLengthCm: StatedRange | null;
	readonly leafWidthCm: StatedRange | null;
	/** A leaflet's size in centimetres, where the first leaf described is a divided frond. */
	readonly leafletCm: { readonly length: StatedRange; readonly width: StatedRange } | null;
	/** How the leaves or branches are set: alternate, opposite, whorled, spiral, rosette or ranked. */
	readonly arrangement: string | null;
	/** The words of the habit line that name a form, in a fixed order. */
	readonly habitWords: readonly string[];
	/** The sheet's sentence for the outline. */
	readonly outline: string | null;
	/** The sheet's lines for the habit, the branching and the leaves, whole. */
	readonly habit: string | null;
	readonly branching: string | null;
	readonly leaves: string | null;
	/** Why each null field is null. */
	readonly missing: Readonly<Record<string, string>>;
}

/** The reason for a field the sheet does not state in words the reader knows. */
const NOT_STATED = 'the fact sheet does not state it in words the reader knows';

const NUMBER = '(\\d+(?:\\.\\d+)?)';
const RANGE = `${NUMBER}(?:\\s+to\\s+${NUMBER})?`;
const METRES: Readonly<Record<string, number>> = { mm: 0.001, cm: 0.01, m: 1 };

/** The shares that the sheets write as words. */
const WORD_SHARES: readonly (readonly [RegExp, number])[] = [
	[/^two thirds/, 2 / 3],
	[/^(?:a|one) third/, 1 / 3],
	[/^(?:a|one) half|^half/, 1 / 2],
	[/^(?:a|one) quarter/, 1 / 4],
	[/^three quarters/, 3 / 4],
];

/** The words of a habit line that name a form. */
const HABIT_WORDS = [
	'dome',
	'column',
	'cone',
	'umbrella',
	'flame',
	'oval',
	'fountain',
	'mound',
	'tuft',
	'rosette',
	'candelabrum',
	'colony',
	'weeping',
	'hanging',
	'arching',
	'broad',
	'narrow',
	'low',
	'flat-topped',
	'rounded',
	'irregular',
	'open',
	'airy',
	'see-through',
	'dense',
	'loose',
] as const;

/** The ways of setting leaves or branches that a sheet names, each with the words that name it. */
const ARRANGEMENTS: readonly (readonly [string, RegExp])[] = [
	['opposite', /\bopposite\b/i],
	['alternate', /\balternate(?:ly)?\b/i],
	['whorled', /\bwhorl(?:ed|s)?\b/i],
	['rosette', /\brosette\b/i],
	['three-ranked', /\bthree ranks\b/i],
	['two-ranked', /\btwo ranks\b/i],
	['spiral', /\bspiral(?:ly)?\b/i],
];

/** A range as numbers, lowest first, to four places. */
function rangeOf(low: string | undefined, high: string | undefined, scale = 1): StatedRange {
	const a = Number(low) * scale;
	const b = high === undefined ? a : Number(high) * scale;
	const fix = (v: number) => Number(v.toFixed(4));
	return [fix(Math.min(a, b)), fix(Math.max(a, b))];
}

/**
 * The bullets of a fact sheet by their bold label, in lower case, each with its lines joined by
 * single spaces.
 */
export function factBullets(text: string): Map<string, string> {
	const bullets = new Map<string, string>();
	let label: string | undefined;
	for (const line of text.split('\n')) {
		const start = /^- \*\*(.+?):\*\*\s*(.*)$/.exec(line);
		if (start) {
			label = (start[1] as string).toLowerCase();
			bullets.set(label, (start[2] as string).trim());
		} else if (label !== undefined && /^\s+\S/.test(line))
			bullets.set(label, `${bullets.get(label)} ${line.trim()}`);
		else label = undefined;
	}
	return bullets;
}

/** A share of the height at the start of a stretch of text: a percentage, a range of them, or words. */
function shareAt(text: string): StatedRange | null {
	const percent = new RegExp(`^${RANGE}\\s*%`).exec(text);
	if (percent) return rangeOf(percent[1], percent[2], 0.01);
	for (const [words, share] of WORD_SHARES)
		if (words.test(text)) return rangeOf(String(share), undefined);
	return null;
}

/** The first share of the height that follows any of the patterns, each of which ends where it starts. */
function shareAfter(text: string, patterns: readonly RegExp[]): StatedRange | null {
	for (const pattern of patterns) {
		const match = pattern.exec(text);
		if (!match) continue;
		const share = shareAt(
			text
				.slice(match.index + match[0].length)
				.replace(/^(?:about|the top|for|is|a little under|,|\s)+/i, ''),
		);
		if (share) return share;
	}
	return null;
}

/** The plant's width over its height, from the first ratio the habit line states. */
function widthToHeightOf(habit: string): StatedRange | null {
	const invert = (range: StatedRange): StatedRange =>
		rangeOf(String(1 / range[1]), String(1 / range[0]));
	const readers: readonly (readonly [RegExp, (m: RegExpExecArray) => StatedRange])[] = [
		[new RegExp(`width (?:is )?about ${RANGE} times the height`, 'i'), (m) => rangeOf(m[1], m[2])],
		[/width about twice the height/i, () => [2, 2]],
		[
			new RegExp(`height (?:is )?about ${RANGE} times the (?:crown's )?width`, 'i'),
			(m) => invert(rangeOf(m[1], m[2])),
		],
		[new RegExp(`width to height about ${RANGE} to 1\\b`, 'i'), (m) => rangeOf(m[1], m[2])],
		[new RegExp(`height to width about ${RANGE} to 1\\b`, 'i'), (m) => invert(rangeOf(m[1], m[2]))],
		[new RegExp(`about ${RANGE} times as tall as wide`, 'i'), (m) => invert(rangeOf(m[1], m[2]))],
		[new RegExp(`about ${RANGE} times as wide as tall`, 'i'), (m) => rangeOf(m[1], m[2])],
		[/about as wide as tall/i, () => [1, 1]],
	];
	let best: { at: number; range: StatedRange } | null = null;
	for (const [pattern, read] of readers) {
		const match = pattern.exec(habit);
		if (match && (best === null || match.index < best.at))
			best = { at: match.index, range: read(match) };
	}
	return best?.range ?? null;
}

/** The sizes a leaf line states, sentence by sentence, in centimetres. */
function leafSizes(leaves: string): { length?: StatedRange; width?: StatedRange }[] {
	const sizes: { length?: StatedRange; width?: StatedRange }[] = [];
	for (const sentence of leaves.split(/(?<=[.;])\s+/)) {
		const long = new RegExp(`${RANGE}\\s*(mm|cm|m)\\s+long`).exec(sentence);
		const wide = new RegExp(`${RANGE}\\s*(mm|cm|m)\\s+wide`).exec(sentence);
		if (!long && !wide) continue;
		sizes.push({
			...(long
				? { length: rangeOf(long[1], long[2], (METRES[long[3] as string] as number) * 100) }
				: {}),
			...(wide
				? { width: rangeOf(wide[1], wide[2], (METRES[wide[3] as string] as number) * 100) }
				: {}),
		});
	}
	return sizes;
}

/**
 * Reads a fact sheet into fields.
 *
 * @param text The sheet's Markdown.
 */
export function readFacts(text: string): StatedFacts {
	const bullets = factBullets(text);
	const habit = bullets.get('habit and silhouette') ?? null;
	const branching = bullets.get('branching') ?? null;
	const leaves = bullets.get('leaves') ?? bullets.get('needles') ?? null;
	const missing: Record<string, string> = {};
	const stated = <T>(name: string, value: T | null | undefined, reason = NOT_STATED): T | null => {
		if (value === null || value === undefined) {
			missing[name] = reason;
			return null;
		}
		return value;
	};
	const lengthIn = (text: string | null, pattern: string): StatedRange | null => {
		const match = text ? new RegExp(pattern, 'i').exec(text) : null;
		return match ? rangeOf(match[1], match[2], METRES[match[3] as string]) : null;
	};
	// A height given for the trunk alone is not the plant's.
	const tall = lengthIn(habit, `(?<!trunk |to |[\\d.])${RANGE}\\s*(mm|cm|m)\\s+tall`);
	const spread =
		lengthIn(habit, `spread\\s+(?:of\\s+)?${RANGE}\\s*(mm|cm|m)\\b`) ??
		lengthIn(habit, `${RANGE}\\s*(mm|cm|m)\\s+wide`);
	const trunk = habit
		? new RegExp(`${RANGE}\\s*(mm|cm|m)\\s+(thick|across[^,.;)]*)`, 'i').exec(habit)
		: null;
	const stems = habit
		? /\b(?:One|Many|Several)\b[^.,;]*?\b(?:trunks?|stems?|crown|tillers)\b[^.;]*/.exec(habit)
		: null;
	const outline = habit ? /\bOutline:?\s+([^.]+)\./.exec(habit) : null;
	const noLeaves = leaves !== null && /^none\b/i.test(leaves);
	const sizes = leaves && !noLeaves ? leafSizes(leaves) : [];
	const first = sizes.find((size) => size.length);
	// A needle line gives one length with no word after it.
	const needle =
		!first && leaves && !noLeaves && bullets.has('needles')
			? lengthIn(leaves, `${RANGE}\\s*(mm|cm|m)\\b`)
			: null;
	const leafLength =
		first?.length ?? (needle ? rangeOf(String(needle[0] * 100), String(needle[1] * 100)) : null);
	const leaflet =
		first && !first.width
			? sizes.find((size) => size !== first && size.length && size.width)
			: undefined;
	const leafReason =
		leaves === null
			? 'the fact sheet has no line for the leaves'
			: noLeaves
				? 'the fact sheet says the plant has no leaves'
				: NOT_STATED;
	let arrangement: string | null = null;
	for (const source of [branching, leaves]) {
		if (!source || arrangement) continue;
		let at = Number.POSITIVE_INFINITY;
		for (const [name, pattern] of ARRANGEMENTS) {
			const match = pattern.exec(source);
			if (match && match.index < at) {
				at = match.index;
				arrangement = name;
			}
		}
	}
	const noHabit = 'the fact sheet has no line for the habit';
	const habitReason = habit === null ? noHabit : NOT_STATED;
	return {
		names: stated('names', bullets.get('names')),
		heightMetres: stated('heightMetres', tall, habitReason),
		flowerStemMetres: stated(
			'flowerStemMetres',
			lengthIn(habit, `flowering stems\\s+${RANGE}\\s*(mm|cm|m)\\b`),
			habit === null ? noHabit : 'the fact sheet gives no flowering stem height',
		),
		spreadMetres: stated('spreadMetres', spread, habitReason),
		widthToHeight: stated('widthToHeight', habit ? widthToHeightOf(habit) : null, habitReason),
		crownShare: stated(
			'crownShare',
			habit ? shareAfter(habit, [/\bcrown (?=(?:is )?(?:about |the top )+)/i]) : null,
			habitReason,
		),
		clearTrunkShare: stated(
			'clearTrunkShare',
			habit
				? shareAfter(habit, [
						/\b(?:clear|clean|bare)\b[a-z ]*?\b(?:trunk|bole)\b,?/i,
						/\btrunk up to the first limbs\b/i,
					])
				: null,
			habitReason,
		),
		trunkMetres: stated(
			'trunkMetres',
			trunk
				? {
						range: rangeOf(trunk[1], trunk[2], METRES[trunk[3] as string]),
						words: (trunk[4] as string).trim(),
					}
				: null,
			habitReason,
		),
		stems: stated('stems', stems ? stems[0].trim() : null, habitReason),
		leafLengthCm: stated('leafLengthCm', leafLength, leafReason),
		leafWidthCm: stated('leafWidthCm', first?.width, leafReason),
		leafletCm: stated(
			'leafletCm',
			leaflet
				? { length: leaflet.length as StatedRange, width: leaflet.width as StatedRange }
				: null,
			leaves === null ? leafReason : 'the fact sheet describes no leaflet apart from the leaf',
		),
		arrangement: stated('arrangement', arrangement),
		habitWords: habit
			? HABIT_WORDS.filter((word) => new RegExp(`\\b${word}\\b(?!-)`, 'i').test(habit))
			: [],
		outline: stated('outline', outline ? (outline[1] as string).trim() : null, habitReason),
		habit: stated('habit', habit, noHabit),
		branching: stated('branching', branching, 'the fact sheet has no line for the branching'),
		leaves: stated('leaves', leaves, 'the fact sheet has no line for the leaves'),
		missing,
	};
}
