// A species' reference folder for the plant review: every reference file it holds, which of them
// are in use (the folder's INDEX.md marks a remade file's original as superseded), the stills
// sorted into the review's views, the texture sources, the turning videos with the arc each covers,
// the wind videos, and the plant's outline separated from a plain background with the measures a
// reviewer reads from it.
//
// The outline (the mask) works on pictures whose background is plain — an open sky, a seamless grey
// or white, and a meadow below the horizon — or whose sky the surface fit models closely with no
// horizon. It fits a smooth colour surface to the frame's border, above and below the horizon
// separately, calls a pixel background when its CIELAB distance to the surface is small next to the
// border's own noise, and keeps the foreground that joins the plant. Its limits, which a reviewer
// must keep in mind:
// - A picture with neither a plain border nor a fitted sky (bark, the inside of a crown, a twig
//   against foliage) has no mask; `plain` is false and the measures are left out.
// - A clear sky grades across the frame, so its border residual is larger than a studio's paper; a
//   sky is masked only where the fit itself is strong and the residual bounded, and the residual is
//   reported, so a badly fitting sky is refused rather than masked on a guess.
// - Below the horizon the meadow is textured and green, so dark foliage that touches the ground and
//   a ground shadow that joins the trunk can both be counted as plant, and pale foliage against the
//   meadow can be lost. The plant's base is reliable; its outline below the horizon is not.
// - Sky seen through the crown counts as background only where it matches the sky's colour; haze
//   or a bright leaf edge that blends with the sky can open or close a gap.
// - The horizon is found as the strongest colour step across the frame's left and right edges, so a
//   picture with no ground has none, and a plant that covers both edges hides it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { PlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';
import {
	type PlantBackground,
	type PlantView,
	VIEW_SPECS,
} from '../../../tests/pages/lib/plant-review/views.ts';
import {
	blank,
	deltaE76,
	deltaE2000,
	hexOf,
	labImage,
	type Rgba,
	readImage,
	resizeToWidth,
	srgbOf,
} from './image.ts';

/** What a reference file is. */
export type ReferenceKind = 'still' | 'texture' | 'turntable' | 'wind';

/** One file of a reference folder and whether the review must compare it. */
export interface ReferenceFile {
	readonly file: string;
	readonly kind: ReferenceKind;
	/** Whether the review compares it: listed and not superseded, or not listed at all. */
	readonly inUse: boolean;
	/** The file that supersedes it, when the index says it is superseded. */
	readonly supersededBy?: string;
	/** Whether the folder's index has a row for it. */
	readonly listed: boolean;
	/** The index's words for what it shows. */
	readonly shows?: string;
}

/** One reference still or texture source, sorted into the review view that shows the same thing. */
export interface Slot {
	/** The file name. */
	readonly file: string;
	/** Its number, from the file name's prefix. */
	readonly number: number;
	/** Its name without the number and the extension, such as `bark-mid-trunk`. */
	readonly name: string;
	/** Whether it is a still of the plant or a texture source for a material. */
	readonly kind: 'still' | 'texture';
	/** The review view that shows the same thing. */
	readonly view: PlantView;
	/** The view's turn in degrees, for a slot that a side of the plant names. */
	readonly turn?: number;
	/** The view's elevation in degrees, for a slot that looks up or down more than the view does. */
	readonly elevation?: number;
	/** Query fields the slot sets beside its view, such as a limb share or a season. */
	readonly query?: Partial<PlantReviewQuery>;
	/** What the plant stands against in the still. */
	readonly background: PlantBackground;
	/** Whether the still shows the whole plant, so its framing can be measured and matched. */
	readonly framed: boolean;
	/** What the review page cannot show of this slot. */
	readonly note?: string;
}

/** A slot's view and settings, before its file's own facts. */
type SlotRule = Omit<Slot, 'file' | 'number' | 'name' | 'kind' | 'background'> & {
	readonly background?: PlantBackground;
};

/** Looking up the trunk into the crown from beside it, the first fork a little above the frame's middle. */
const FROM_BELOW: SlotRule = { view: 'below', framed: false };

/** Looking up into the crown's underside from under a great limb, back toward the trunk. */
const UNDERNEATH: SlotRule = { view: 'crown-underside', framed: false };

/**
 * Looking up a tall clean bole in leaf from a few steps back with a wide lens: the foot at the
 * frame's foot and the crown's base, where the first limbs leave, at its top, on the rows the
 * photograph shows them on.
 */
const CLEAN_BOLE: SlotRule = {
	view: 'below',
	query: { fov: 75, footRow: 0.96, crownRow: 0.09 },
	framed: false,
};

/**
 * A cactus's rib, areole and spine close-ups: the skin's own surface, where the areoles and their
 * spine clusters stand, rather than a leaf or a twig. The span frames an areole and its neighbours.
 */
const SKIN_CLOSE: SlotRule = {
	view: 'bark-mid',
	query: { span: 0.2 },
	framed: false,
	note: 'a cactus skin close-up: judged on the waxy ribbed skin at close range',
};

/**
 * Whether a picture's name is a cactus's skin close-up: its ribs, areoles or spines. A leaf's ribs
 * and veins, such as a hosta's ribbed blade, are the leaf's own surface.
 */
function cactusSkin(name: string): boolean {
	return /rib|areole|spine/.test(name) && !/leaf/.test(name);
}

/** A woodpecker's nest holes in an old cactus trunk: the same skin, framed wider. */
const NEST_HOLES: SlotRule = {
	view: 'bark-mid',
	query: { span: 0.55 },
	framed: false,
};

/** A stem cut across: the cut face's rib star, woody ring and flesh. */
const STEM_SECTION: SlotRule = {
	view: 'section',
	background: 'white',
	framed: false,
};

/** A branch with its side branches: the branch cutting laid across a frame of the photograph's scale. */
const SECONDARY_BRANCHING: SlotRule = {
	view: 'branch',
	background: 'studio-grey',
	elevation: 0,
	query: { leaves: 7.4, roll: -90 },
	framed: false,
};

/** The finest twigs with their end clusters: the sub-branch cutting at the photograph's scale. */
const FINE_TWIGS: SlotRule = {
	view: 'subbranch',
	background: 'studio-grey',
	elevation: 0,
	query: { leaves: 4.5 },
	framed: false,
};

/** The slot rules, first match wins: words in the still's name, and the slot they name. */
const SLOT_RULES: readonly { readonly test: (name: string) => boolean; readonly slot: SlotRule }[] =
	[
		// A stem cut across is a section of its own, for the cactus and the sedge alike. It comes
		// before the rib rule below, which would otherwise read the cactus's cross-section as a skin
		// close-up.
		{ test: (n) => /cross-section|cut-across/.test(n), slot: STEM_SECTION },
		// A cactus's single spine cluster and single areole are the leaf's own card on a plain ground,
		// as their studio stills are: the species' leaf is the cluster.
		{
			test: (n) => /spine-cluster|single-areole/.test(n),
			slot: { view: 'leaf-upper', framed: false },
		},
		// A cactus's ribs, areoles and spine clusters are the skin's own close view: the species has no
		// leaf or twig for the leaf and twig views to cut, and its body is one ribbed surface.
		{ test: cactusSkin, slot: SKIN_CLOSE },
		{ test: (n) => /\bnest|\bholes?\b/.test(n), slot: NEST_HOLES },
		// A cactus's arms are its limbs: the whole arm, its underside and its elbow are limb views,
		// and the crownless plant has no fork for the fork view to find.
		{
			test: (n) => /arms?-outside|between-arms/.test(n),
			slot: { view: 'limb', query: { span: 2.5, thin: 0.24 }, framed: false },
		},
		{
			test: (n) => /arm.*underside/.test(n),
			slot: { view: 'limb', elevation: -30, query: { span: 1.5, thin: 0.24 }, framed: false },
		},
		{
			test: (n) => /arm-elbow/.test(n),
			slot: { view: 'limb', query: { span: 1.2, thin: 0.24 }, framed: false },
		},
		{
			test: (n) => /arm-tip/.test(n),
			slot: { view: 'limb', query: { span: 0.35, thin: 0.24 }, framed: false },
		},
		// Bamboo's own close views: the reference set frames a culm's foot, a node, a sheath and a cut
		// section where no tree view fits.
		{
			test: (n) => n.includes('culm-base'),
			slot: { view: 'bark-base', framed: false },
		},
		{
			test: (n) => n.includes('culm-node'),
			slot: { view: 'bark-mid', query: { span: 0.22 }, framed: false },
		},
		{
			// A sheath sits at a young culm's lower nodes, so the view frames the foot, not a limb.
			test: (n) => n.includes('culm-sheath'),
			slot: { view: 'bark-base', background: 'studio-grey', query: { span: 0.35 }, framed: false },
		},
		{
			test: (n) => n.includes('cut-culm'),
			slot: { view: 'bark-mid', query: { span: 0.2 }, framed: false },
		},
		{
			// A wall of bare culms at eye height: the bole view looks up the nearest culm, the closest
			// view the set has to that surface.
			test: (n) => n.includes('clump-outside'),
			slot: { view: 'trunk', framed: false },
		},
		{
			// The spring spear is its own form of the plant, framed whole against the sky.
			test: (n) => n.includes('new-shoot'),
			slot: { view: 'whole', framed: true, background: 'sky-meadow' },
		},
		// A cut piece on a plain ground, framed as its photograph frames it: the photograph's piece
		// sets the rows its top and its foot land on.
		{ test: (n) => n.includes('subbranch-studio'), slot: { view: 'subbranch', framed: true } },
		{ test: (n) => n.includes('leaf-cluster-studio'), slot: { view: 'cluster', framed: true } },
		{ test: (n) => n.includes('branch-studio'), slot: { view: 'branch', framed: true } },
		{ test: (n) => n.includes('silhouette'), slot: { view: 'silhouette', framed: true } },
		{ test: (n) => n.includes('profile'), slot: { view: 'whole', turn: 90, framed: true } },
		{
			test: (n) => /(leaf|needle|frond|blade).*(underside|lower)/.test(n),
			slot: { view: 'leaf-under', framed: false },
		},
		{
			test: (n) => /(leaf|needle|frond|blade).*upper/.test(n),
			slot: { view: 'leaf-upper', framed: false },
		},
		{
			// A ground plant's flowering heads: one stem's hanging spikes, seen close and level, where
			// a twig view has no woody stem to frame and falls back to the whole plant.
			test: (n) => /flower.*spike/.test(n),
			slot: { view: 'spike', framed: false },
		},
		{
			// Looking up the whole height from the foot: the stem's first fork stands a little above the
			// middle of the frame, with the first limbs running out from it.
			test: (n) => n.includes('from-below'),
			slot: FROM_BELOW,
		},
		{
			// Looking up into the crown from under a great limb, the trunk low in the frame.
			test: (n) => /(crown|canopy).*(underside|underneath)/.test(n),
			slot: UNDERNEATH,
		},
		{
			// The crown at soil level, its shoot sheaths against a plain ground: a view of the foot
			// from the side, aimed where the columns leave the soil.
			test: (n) => n.includes('basal-crown'),
			slot: { view: 'crown-foot', framed: false },
		},
		{ test: (n) => n.includes('inside'), slot: { view: 'inside', framed: false } },
		{
			// The crown's outer surface seen from outside it: one foliage mass at the crown's edge
			// against the sky.
			test: (n) => /(crown|clump)-(outside|edge)/.test(n),
			slot: { view: 'limb', query: { surface: true }, framed: false },
		},
		{
			test: (n) => n.includes('frond-base-on-trunk'),
			slot: { view: 'junction', framed: false },
		},
		{
			// A palm's frond from its base, cut and laid on a plain ground as its photograph shows
			// it: the whole frond, framed at the scale of some seven leaflets, not the clasp on the
			// trunk that a woody species' limb picture shows.
			test: (n) => n.includes('frond-base') || n.includes('frond-mid'),
			slot: {
				view: 'branch',
				background: 'studio-grey',
				elevation: 0,
				query: { leaves: 7.4 },
				framed: false,
			},
		},
		{
			test: (n) => n.includes('limb-leaving') || n.includes('culm-base'),
			slot: { view: 'junction', framed: false },
		},
		{ test: (n) => n.includes('fork'), slot: { view: 'fork', framed: false } },
		{
			// A branch with its side branches, cut and laid across the frame on a plain ground as its
			// photograph lays it, at the photograph's own scale of some seven leaf lengths, so the
			// branch runs off both edges.
			test: (n) => n.includes('secondary-branching'),
			slot: SECONDARY_BRANCHING,
		},
		{
			test: (n) => n.includes('culm-branching'),
			slot: {
				view: 'limb',
				background: 'studio-grey',
				query: { span: 0.6, thin: 0.025 },
				framed: false,
			},
		},
		{
			// One fine twig with its end clusters, cut and standing on a plain ground as its photograph
			// shows it, entering from the lower edge, at the photograph's scale of some four leaf lengths.
			test: (n) => n.includes('twig') || n.includes('branchlet'),
			slot: FINE_TWIGS,
		},
		{
			test: (n) => /cluster|spray|shoot-leaves|needles/.test(n),
			slot: { view: 'cluster', background: 'white', framed: true },
		},
		{
			test: (n) => n.includes('bark-base') || n.includes('root'),
			slot: { view: 'bark-base', framed: false },
		},
		{ test: (n) => n.includes('bark-mid'), slot: { view: 'bark-mid', framed: false } },
		{
			// The bark on a large limb with the limb itself in view, its thickness filling the share of
			// the frame that the photograph gives it.
			test: (n) => /bark.*limb|limb.*bark/.test(n),
			slot: { view: 'bark-limb', query: { girth: 0.38, along: 0.3 }, framed: false },
		},
		{
			// A ground plant's sheath, collar or ligule: one tiller's column, seen side on at the
			// scale the photograph frames it, since such a plant has no woody stem to show. The
			// name must begin with the part, so a blade leaving its sheath keeps its fork picture.
			test: (n) => /^(sheath|ligule|collar)/.test(n),
			slot: { view: 'sheath', framed: false },
		},
		{
			// A winter picture of a branch shows one branch on its own against the sky, as its
			// reference does: the summer branch cutting, drawn in the season the name gives. A crop
			// into the whole plant puts other limbs behind it and cannot be read the same way.
			test: (n) => /(winter|bare)/.test(n) && /(branch|architecture)/.test(n),
			slot: {
				view: 'branch',
				background: 'sky-meadow',
				query: { season: 'winter' },
				framed: false,
			},
		},
		{
			test: (n) => n.includes('winter') || n.includes('architecture') || n.includes('bare'),
			// A winter picture is a limb close-up, as its reference is, framed close enough that the
			// twigs and the bud clusters at their nodes stand at the size the reference shows.
			slot: { view: 'limb', query: { season: 'winter', span: 0.2, thin: 0.03 }, framed: false },
		},
		{ test: (n) => n.includes('clean-bole'), slot: CLEAN_BOLE },
		{
			test: (n) => n.includes('taper') || n.includes('bole') || n.includes('lower-branches'),
			slot: { view: 'trunk', framed: false },
		},
		{ test: (n) => n.includes('skirt'), slot: { view: 'crown', elevation: -5, framed: false } },
		{
			test: (n) => n.includes('branching'),
			slot: { view: 'fork', query: { distance: 2.5 }, framed: false },
		},
		{
			// A plant that flowers at its crown, such as a cactus, shows a ring of flowers at the stem's
			// top: the picture frames the ring's own sites, not the plant's middle that the crown view
			// takes or a single shoot tip. The name must say the flowers stand on the crown, so a
			// species' flower detail or flower spikes keep the view their number gives.
			test: (n) => /flowers?.*crown|crown.*flowers?/.test(n),
			slot: { view: 'flowers', framed: false },
		},
		{ test: (n) => n.includes('crown'), slot: { view: 'crown', framed: false } },
		{ test: (n) => n.includes('bark'), slot: { view: 'bark-mid', framed: false } },
		{ test: (n) => /whole|distant|form|dome/.test(n), slot: { view: 'whole', framed: true } },
	];

/** The slot of each standard number, for a still whose name says nothing the rules know. */
const SLOT_BY_NUMBER: Readonly<Record<number, SlotRule>> = {
	1: { view: 'whole', framed: true },
	2: { view: 'whole', turn: 90, framed: true },
	3: FROM_BELOW,
	4: { view: 'crown', framed: false },
	5: UNDERNEATH,
	6: { view: 'inside', framed: false },
	7: { view: 'junction', framed: false },
	8: { view: 'fork', framed: false },
	9: SECONDARY_BRANCHING,
	10: FINE_TWIGS,
	11: { view: 'cluster', background: 'white', framed: true },
	12: { view: 'leaf-upper', framed: false },
	13: { view: 'leaf-under', framed: false },
	14: { view: 'bark-base', framed: false },
	15: { view: 'bark-mid', framed: false },
	16: { view: 'bark-limb', query: { girth: 0.38, along: 0.3 }, framed: false },
	17: { view: 'trunk', framed: false },
	18: { view: 'silhouette', framed: true },
	19: {
		view: 'twigs',
		query: { fruit: true },
		framed: false,
		note: 'flowers, fruit or cones: judged on the shoot tip, in the season the name gives',
	},
	20: { view: 'limb', query: { season: 'winter', span: 0.2, thin: 0.03 }, framed: false },
	21: { view: 'branch', framed: true },
	22: { view: 'subbranch', framed: true },
	23: { view: 'cluster', framed: true },
};

/** The texture sources by number: the render's own surface that each is laid beside, at scale. */
const TEXTURE_BY_NUMBER: Readonly<Record<number, SlotRule>> = {
	24: { view: 'leaf-upper', framed: false },
	25: { view: 'leaf-under', framed: false },
	26: { view: 'bark-mid', framed: false },
	27: { view: 'bark-mid', framed: false, note: "the second bark zone, at the zone's own height" },
	28: {
		view: 'bark-limb',
		// Young bark is two to three centimetres thick, so the view asks for that wood rather than a
		// great limb, and masks the backdrop so the crown behind it does not enter the figure.
		query: { along: 0.85, thin: 0.015, span: 0.1, barkMask: true },
		framed: false,
		note: 'young bark: thin wood far out on a limb',
	},
};

/**
 * Words that place a still in a season: flowers in blossom, ripe fruit in autumn, a leafless plant in
 * winter. Cones are left out, since a conifer carries them all year.
 */
const SEASON_WORDS: readonly (readonly [RegExp, NonNullable<PlantReviewQuery['season']>])[] = [
	[/blossom|flower|catkin/, 'blossom'],
	[/autumn|acorn|fruit|berr|\bnuts?\b|\bhips?\b|\bhaws?\b|ripe/, 'autumn'],
	[/winter|\bbare\b|leafless/, 'winter'],
];

/** The slots that show a season of their own: flowers or fruit, and the species' extra view. */
const SEASON_SLOTS: ReadonlySet<number> = new Set([19, 20]);

/**
 * The season a still shows, if it shows one: the one its name's words give, else, for a slot that
 * shows a season of its own, the one its index row's "what it shows" cell gives. Other stills' rows
 * mention seasons in passing, so only their names count.
 */
function seasonOf(
	number: number,
	name: string,
	shows: string | undefined,
): Partial<PlantReviewQuery> {
	const texts = [name.replace(/-/g, ' ')];
	if (SEASON_SLOTS.has(number) && shows) texts.push(shows.toLowerCase());
	for (const text of texts)
		for (const [words, season] of SEASON_WORDS) if (words.test(text)) return { season };
	return {};
}

/** Hues in degrees of green leaves, and of autumn leaves turned yellow, orange or brown. */
const GREEN_HUES = [70, 170] as const;
const AUTUMN_HUES = [10, 60] as const;
/** The least saturation of a pixel that counts toward either. */
const LEAF_SATURATION = 0.2;

/**
 * Whether a picture's leaves are still green: more of its coloured pixels take a green hue than an
 * autumn one. A still of ripe fruit among green leaves shows late summer, though its name names a
 * fruit of autumn.
 *
 * @param image The picture.
 * @returns True where green outweighs the autumn colours.
 */
export function greenLeaves(image: Rgba): boolean {
	let green = 0;
	let autumn = 0;
	const d = image.data;
	for (let i = 0; i < d.length; i += 4) {
		const r = (d[i] as number) / 255;
		const g = (d[i + 1] as number) / 255;
		const b = (d[i + 2] as number) / 255;
		const max = Math.max(r, g, b);
		const range = max - Math.min(r, g, b);
		if (max === 0 || range / max < LEAF_SATURATION) continue;
		let hue =
			max === r ? ((g - b) / range) % 6 : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
		hue = (hue * 60 + 360) % 360;
		if (hue >= GREEN_HUES[0] && hue <= GREEN_HUES[1]) green++;
		else if (hue >= AUTUMN_HUES[0] && hue < AUTUMN_HUES[1]) autumn++;
	}
	return green > autumn;
}

/**
 * A still's slot with the season its picture shows: one that its words place in autumn is drawn in
 * summer where its leaves are still green.
 *
 * @param slot The slot as its name and index row give it.
 * @param image The still's picture.
 * @returns The slot.
 */
export function seasonFromPicture(slot: Slot, image: Rgba): Slot {
	if (slot.query?.season !== 'autumn' || !greenLeaves(image)) return slot;
	return { ...slot, query: { ...slot.query, season: 'summer' } };
}

/** The first number past the standard views, studio stills and texture sources: other forms. */
const OTHER_FORMS = 29;

/**
 * The species form a still shows, of the record's other forms: the first whose name its file name
 * gives as a word. An index row's words are not read for it: a row may name another form in passing,
 * as "unlike the young oak" does, and the standard stills' rows speak of young wood on the grown
 * plant.
 */
function formOf(name: string, forms: readonly string[]): string | undefined {
	const words = name.replace(/-/g, ' ');
	for (const form of forms)
		if (new RegExp(`\\b${form.replace(/-/g, ' ')}\\b`).test(words)) return form;
	return undefined;
}

/** The texture rule of a texture source that its number does not name. */
function textureRule(number: number, name: string): SlotRule {
	// A cactus's texture sources hold its spine clusters, not leaves: its surface is the ribbed stem.
	if (cactusSkin(name)) return SKIN_CLOSE;
	const known = TEXTURE_BY_NUMBER[number];
	if (known) return known;
	if (/leaf|needle|frond|blade/.test(name))
		return (name.includes('under') ? TEXTURE_BY_NUMBER[25] : TEXTURE_BY_NUMBER[24]) as SlotRule;
	return TEXTURE_BY_NUMBER[26] as SlotRule;
}

/**
 * The slot of a numbered still or texture source, or undefined for any other file.
 *
 * @param file The file's name.
 * @param shows The "what it shows" cell of its index row, which may give its season.
 * @param forms The names of the species' other forms, such as `young`: a still whose name names one
 *   is drawn in that form.
 */
export function classifySlot(
	file: string,
	shows?: string,
	forms: readonly string[] = [],
): Slot | undefined {
	const match = /^(\d\d)-(.+)\.(png|jpe?g|webp)$/i.exec(file);
	if (!match) return undefined;
	const number = Number(match[1]);
	const name = (match[2] as string).toLowerCase();
	const texture =
		name.includes('texture') || name.includes('young-bark') || number in TEXTURE_BY_NUMBER;
	const rule = texture
		? textureRule(number, name)
		: (SLOT_RULES.find((r) => r.test(name))?.slot ??
			SLOT_BY_NUMBER[number] ??
			// A still of another form that names no part of the plant shows the whole of it.
			(number >= OTHER_FORMS ? { view: 'whole', framed: true } : undefined));
	if (!rule) return undefined;
	const notes = [rule.note];
	// A young or other-habit form is a different plant from the mature one that a variant grows: the
	// record's own form of it when the record has one, else the grown variant with a note.
	const form = texture ? undefined : formOf(name, forms);
	if (form) notes.push(`drawn in the record's ${form} form`);
	else if (/young|juvenile|sapling/.test(name) && !texture)
		notes.push('a young form: the variant grows the mature plant');
	else if (number >= OTHER_FORMS)
		notes.push('another habit of the species: judged beside the grown variant');
	// The season the still shows wins over its slot's default.
	const query = {
		...rule.query,
		...(texture ? {} : seasonOf(number, name, shows)),
		...(form && { form }),
	};
	const note = notes.filter(Boolean).join('; ');
	return {
		file,
		number,
		name,
		kind: texture ? 'texture' : 'still',
		...rule,
		background: rule.background ?? VIEW_SPECS[rule.view].background,
		...(Object.keys(query).length > 0 ? { query } : {}),
		...(note ? { note } : {}),
	};
}

/**
 * A query with a reference file's own fields laid over it, from the slot file: each field replaces
 * the query's, and a field given as null drops it.
 */
export function withSlot(
	query: PlantReviewQuery,
	extra: Readonly<Record<string, unknown>> | undefined,
): PlantReviewQuery {
	if (!extra) return query;
	const merged: Record<string, unknown> = { ...query };
	for (const [name, value] of Object.entries(extra))
		if (value === null) delete merged[name];
		else merged[name] = value;
	return merged as unknown as PlantReviewQuery;
}

/** The pieces a turning video turns round. */
export type TurnPiece = 'whole' | 'branch' | 'subbranch' | 'cluster';

/** One turning video: the piece it turns round and the arc it covers. */
export interface TurnVideo {
	readonly file: string;
	readonly path: string;
	readonly piece: TurnPiece;
	/** Degrees the camera turns over the video's length: 360, or 180 for a half turn. */
	readonly arc: number;
}

/** The piece and arc of a turning video's file name, or undefined for a file that is not one. */
export function classifyTurn(file: string): Omit<TurnVideo, 'path'> | undefined {
	const match = /^(.*?)-?turntable(-halfturn)?(-[a-z])*\.mp4$/i.exec(file);
	if (!match) return undefined;
	const prefix = (match[1] ?? '').toLowerCase();
	const piece: TurnPiece =
		prefix === 'subbranch'
			? 'subbranch'
			: prefix === 'branch'
				? 'branch'
				: prefix === 'leaf-cluster'
					? 'cluster'
					: 'whole';
	return { file, piece, arc: match[2] ? 180 : 360 };
}

/** The view that a turning video's piece is drawn in. */
export const TURN_VIEW: Readonly<Record<TurnPiece, PlantView>> = {
	whole: 'whole',
	branch: 'branch',
	subbranch: 'subbranch',
	cluster: 'cluster',
};

/** One row of a folder's index: the file it names and its words for what the file shows. */
export interface IndexRow {
	readonly file: string;
	readonly shows: string;
	readonly supersededBy?: string;
}

/**
 * The rows of an INDEX.md: each table row whose first cell names a file in backticks. A row whose
 * "what it shows" cell says the file is superseded marks it out of use, with the file that
 * supersedes it when the cell names one. A later cell that says "Superseded by" a file, with a
 * capital, marks it out of use too; "is superseded by" there speaks of another file.
 */
export function readIndex(text: string): IndexRow[] {
	const rows: IndexRow[] = [];
	for (const line of text.split('\n')) {
		const cells = line.split('|').map((cell) => cell.trim());
		// A table row starts and ends with a bar, so its first and last cells are empty.
		const file = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1];
		if (!file) continue;
		const shows = cells[2] ?? '';
		const later = cells.slice(3).join(' ');
		const laterBy = /\bSuperseded by `([^`]+)`/.exec(later)?.[1];
		const superseded = /\bsuperseded\b/i.test(shows) || laterBy !== undefined;
		const by = /superseded by `([^`]+)`/i.exec(shows)?.[1] ?? laterBy;
		rows.push({ file, shows, ...(superseded ? { supersededBy: by ?? 'a later file' } : {}) });
	}
	return rows;
}

/** A species' reference folder: every reference file, and those in use by kind. */
export interface ReferenceSet {
	readonly folder: string;
	/** The folder's own name, the species' slug. */
	readonly slug: string;
	/** Every reference file, in name order, in use or not. */
	readonly files: readonly ReferenceFile[];
	/** The stills and texture sources in use, in number order, each with its slot. */
	readonly stills: readonly Slot[];
	/** The turning videos in use. */
	readonly turns: readonly TurnVideo[];
	/** The wind videos in use. */
	readonly winds: readonly string[];
	/** Files in use that no slot, turn or wind rule knows, which the review cannot draw a view for. */
	readonly unknown: readonly string[];
}

/** Whether a file is a reference: a picture or a video, but not a video's contact sheet. */
function isReference(file: string): boolean {
	return /\.(png|jpe?g|webp|mp4)$/i.test(file) && !/-sheet\.png$/i.test(file);
}

/**
 * Reads a reference folder: its index's rows, and every reference file sorted by kind. A still whose
 * name names one of the species' other forms is drawn in that form.
 */
export function readReferenceSet(folder: string, forms: readonly string[] = []): ReferenceSet {
	const indexPath = join(folder, 'INDEX.md');
	const rows = existsSync(indexPath) ? readIndex(readFileSync(indexPath, 'utf8')) : [];
	const byFile = new Map(rows.map((row) => [row.file, row]));
	const files: ReferenceFile[] = [];
	const stills: Slot[] = [];
	const turns: TurnVideo[] = [];
	const winds: string[] = [];
	const unknown: string[] = [];
	for (const file of readdirSync(folder).sort()) {
		if (!isReference(file)) continue;
		const row = byFile.get(file);
		const inUse = row?.supersededBy === undefined;
		const named = classifySlot(file, row?.shows, forms);
		const slot =
			named?.query?.season === 'autumn'
				? seasonFromPicture(named, readImage(join(folder, file)))
				: named;
		const turn = classifyTurn(file);
		const wind = /wind/i.test(file) && file.toLowerCase().endsWith('.mp4');
		const kind: ReferenceKind = slot ? slot.kind : turn ? 'turntable' : wind ? 'wind' : 'still';
		files.push({
			file,
			kind,
			inUse,
			listed: row !== undefined,
			...(row?.supersededBy ? { supersededBy: row.supersededBy } : {}),
			...(row ? { shows: row.shows } : {}),
		});
		if (!inUse) continue;
		if (slot) stills.push(slot);
		else if (turn) turns.push({ ...turn, path: join(folder, file) });
		else if (wind) winds.push(join(folder, file));
		else unknown.push(file);
	}
	stills.sort((a, b) => a.number - b.number || a.file.localeCompare(b.file));
	return { folder, slug: basename(folder), files, stills, turns, winds, unknown };
}

/** The widest picture the masks and the measures work on, in pixels. */
export const WORK_WIDTH = 640;

/** A smooth colour surface over the frame: a quadratic in x and y for each CIELAB channel. */
export interface ColourSurface {
	/** Six coefficients for each channel, for 1, x, y, x², y² and xy over shares of the frame. */
	readonly coefficients: readonly (readonly number[])[];
	/** The spread of the border's own colours about the surface, as a CIELAB distance. */
	readonly noise: number;
	/** The share of the border's samples that the surface fits, from 0 to 1. */
	readonly fit: number;
}

/** The surface's colour at a point given as shares of the frame. */
export function surfaceAt(surface: ColourSurface, x: number, y: number): [number, number, number] {
	const terms = [1, x, y, x * x, y * y, x * y];
	const out: [number, number, number] = [0, 0, 0];
	for (let c = 0; c < 3; c++) {
		const k = surface.coefficients[c] as readonly number[];
		let sum = 0;
		for (let t = 0; t < 6; t++) sum += (k[t] as number) * (terms[t] as number);
		out[c] = sum;
	}
	return out;
}

/** Solves a small linear system by Gaussian elimination with partial pivoting. */
export function solve(matrix: number[][], vector: number[]): number[] {
	const n = vector.length;
	const a = matrix.map((row, i) => [...row, vector[i] as number]);
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let row = col + 1; row < n; row++)
			if (
				Math.abs((a[row] as number[])[col] as number) >
				Math.abs((a[pivot] as number[])[col] as number)
			)
				pivot = row;
		[a[col], a[pivot]] = [a[pivot] as number[], a[col] as number[]];
		const p = (a[col] as number[])[col] as number;
		if (Math.abs(p) < 1e-12) continue;
		for (let row = 0; row < n; row++) {
			if (row === col) continue;
			const f = ((a[row] as number[])[col] as number) / p;
			for (let k = col; k <= n; k++)
				(a[row] as number[])[k] =
					((a[row] as number[])[k] as number) - f * ((a[col] as number[])[k] as number);
		}
	}
	return a.map((row, i) => {
		const p = row[i] as number;
		return Math.abs(p) < 1e-12 ? 0 : (row[n] as number) / p;
	});
}

/**
 * Fits a colour surface to samples by least squares, dropping the samples that sit far from it
 * and fitting again, so a plant that covers part of the border does not pull the surface.
 * `samples` holds x, y (shares) and L, a, b for each sample.
 */
export function fitSurface(samples: Float32Array, flat = false): ColourSurface {
	const count = samples.length / 5;
	let inliers = new Uint8Array(count).fill(1);
	let coefficients: number[][] = [
		[0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0],
	];
	let noise = 0;
	const terms = flat ? 1 : 6;
	for (let pass = 0; pass < 5; pass++) {
		const matrix = Array.from({ length: terms }, () => new Array<number>(terms).fill(0));
		const vectors = [0, 1, 2].map(() => new Array<number>(terms).fill(0));
		let used = 0;
		for (let i = 0; i < count; i++) {
			if (!inliers[i]) continue;
			used++;
			const x = samples[i * 5] as number;
			const y = samples[i * 5 + 1] as number;
			const t = [1, x, y, x * x, y * y, x * y].slice(0, terms);
			for (let r = 0; r < terms; r++) {
				for (let c = 0; c < terms; c++)
					(matrix[r] as number[])[c] =
						((matrix[r] as number[])[c] as number) + (t[r] as number) * (t[c] as number);
				for (let ch = 0; ch < 3; ch++)
					(vectors[ch] as number[])[r] =
						((vectors[ch] as number[])[r] as number) +
						(t[r] as number) * (samples[i * 5 + 2 + ch] as number);
			}
		}
		if (used < terms * 4) break;
		// A light ridge keeps the fit steady when the samples cover the frame unevenly.
		for (let r = 1; r < terms; r++)
			(matrix[r] as number[])[r] = ((matrix[r] as number[])[r] as number) + used * 1e-4;
		coefficients = vectors.map((v) => {
			const k = solve(
				matrix.map((row) => [...row]),
				v,
			);
			return [...k, 0, 0, 0, 0, 0, 0].slice(0, 6);
		});
		const surface = { coefficients, noise: 0, fit: 1 };
		const residuals = new Float32Array(count);
		for (let i = 0; i < count; i++)
			residuals[i] = deltaE76(
				surfaceAt(surface, samples[i * 5] as number, samples[i * 5 + 1] as number),
				[samples[i * 5 + 2] as number, samples[i * 5 + 3] as number, samples[i * 5 + 4] as number],
			);
		const kept = Array.from(residuals.filter((_, i) => inliers[i] === 1)).sort((a, b) => a - b);
		const median = kept[kept.length >> 1] ?? 0;
		noise = Math.max(0.5, median * 1.4826);
		const limit = Math.max(6, noise * 3);
		const next = new Uint8Array(count);
		for (let i = 0; i < count; i++) next[i] = (residuals[i] as number) < limit ? 1 : 0;
		inliers = next;
	}
	let fitted = 0;
	for (let i = 0; i < count; i++) fitted += inliers[i] as number;
	return { coefficients, noise, fit: count > 0 ? fitted / count : 0 };
}

/** The background of a picture: the horizon, the sky's surface and the ground's below it. */
export interface Background {
	/** The horizon's row in the work picture, or null when the picture has no ground. */
	readonly horizon: number | null;
	readonly sky: ColourSurface;
	readonly ground?: ColourSurface;
	/** Whether the border is plain enough for a mask: most of it fits a smooth surface. */
	readonly plain: boolean;
}

/** The median of the CIELAB colours of a strip of columns in one row. */
function stripMedian(
	lab: Float32Array,
	width: number,
	y: number,
	from: number,
	to: number,
): number[] {
	const channels: number[][] = [[], [], []];
	for (let x = from; x < to; x++)
		for (let c = 0; c < 3; c++)
			(channels[c] as number[]).push(lab[(y * width + x) * 3 + c] as number);
	return channels.map((values) => {
		values.sort((a, b) => a - b);
		return values[values.length >> 1] ?? 0;
	});
}

/**
 * The horizon's row: the strongest colour step down the frame's left and right edges, where the
 * sky above differs from the ground below. Null when no step is strong enough, as in a studio.
 */
export function findHorizon(lab: Float32Array, width: number, height: number): number | null {
	const strip = Math.max(2, Math.round(width * 0.06));
	const rows = Array.from({ length: height }, (_, y) => [
		stripMedian(lab, width, y, 0, strip),
		stripMedian(lab, width, y, width - strip, width),
	]);
	const k = Math.max(2, Math.round(height * 0.015));
	let best = -1;
	let bestScore = 0;
	// A horizon can sit a few rows above the frame's foot, so the window below it narrows there.
	for (let y = k; y <= height - 2; y++) {
		const under = Math.min(k, height - y);
		let score = 0;
		for (let side = 0; side < 2; side++) {
			const above = [0, 0, 0];
			const below = [0, 0, 0];
			for (let i = 1; i <= k; i++)
				for (let c = 0; c < 3; c++)
					above[c] =
						(above[c] as number) +
						(((rows[y - i] as number[][])[side] as number[])[c] as number) / k;
			for (let i = 1; i <= under; i++)
				for (let c = 0; c < 3; c++)
					below[c] =
						(below[c] as number) +
						(((rows[y + i - 1] as number[][])[side] as number[])[c] as number) / under;
			score += deltaE76(above, below);
		}
		if (score > bestScore) {
			bestScore = score;
			best = y;
		}
	}
	// Both edges together must step by a clear colour difference.
	return bestScore / 2 >= 12 ? best : null;
}

/** The border samples of a region of rows, as x, y, L, a, b for each sample. */
function borderSamples(
	lab: Float32Array,
	width: number,
	height: number,
	from: number,
	to: number,
	top: boolean,
	bottom: boolean,
): Float32Array {
	const strip = Math.max(2, Math.round(width * 0.06));
	const band = Math.max(2, Math.round(height * 0.05));
	const out: number[] = [];
	const step = Math.max(1, Math.round(width / 320));
	for (let y = from; y < to; y += step)
		for (let x = 0; x < width; x += step) {
			const edge =
				x < strip || x >= width - strip || (top && y < from + band) || (bottom && y >= to - band);
			if (!edge) continue;
			const at = (y * width + x) * 3;
			out.push(
				x / width,
				y / height,
				lab[at] as number,
				lab[at + 1] as number,
				lab[at + 2] as number,
			);
		}
	return Float32Array.from(out);
}

/** The background of a picture in CIELAB, from its border. */
export function backgroundOf(lab: Float32Array, width: number, height: number): Background {
	const horizon = findHorizon(lab, width, height);
	const gap = Math.max(1, Math.round(height * 0.01));
	const skyTo = horizon === null ? height : Math.max(1, horizon - gap);
	const sky = fitSurface(borderSamples(lab, width, height, 0, skyTo, true, horizon === null));
	const ground =
		horizon !== null && horizon + gap < height - 2
			? fitSurface(borderSamples(lab, width, height, horizon + gap, height, false, true))
			: undefined;
	return {
		horizon,
		sky,
		...(ground ? { ground } : {}),
		plain: sky.fit >= 0.55 && sky.noise < 12,
	};
}

/**
 * The surface fit above which a sky counts as modelled rather than guessed, and the residual within
 * which it still separates a plant from the sky. A clear sky grades across the frame, so its border
 * residual is larger than a studio's plain paper and the old plain gate refused it; the fit itself
 * says whether the grade is a model or noise. A sky whose fit is weak, or whose residual is wide,
 * stays refused rather than masked on a guess.
 */
export const SKY_MASK_FIT = 0.99;
export const SKY_MASK_NOISE = 24;

/**
 * Whether a background that is not plain can still mask a plant: a fitted sky with no horizon. The
 * mask's own sky threshold scales by the fit's residual, so a badly fitting sky cannot pass it; this
 * gate only admits a sky the surface fit models closely.
 */
export function skyMaskable(background: Background): boolean {
	return (
		background.horizon === null &&
		background.sky.fit >= SKY_MASK_FIT &&
		background.sky.noise <= SKY_MASK_NOISE
	);
}

/** The least share of the frame each of the sky and the ground keeps for a horizon to stand between them. */
export const SOIL_MASK_EDGE = 0.05;

/**
 * The share of the frame a soil band under a backdrop usually holds. Outside it a fit whose ground
 * region is smaller or larger is flagged rather than trusted: the line is likely misplaced or the
 * plant's own material is inside the ground model.
 */
export const SOIL_MASK_GROUND_SHARE: readonly [number, number] = [0.1, 0.6];

/**
 * Whether a background with a horizon can still mask a plant: the ground surface models the soil
 * below the horizon, and the horizon leaves a real region to each side. The mask's ground threshold
 * scales by the ground's residual, so a badly fitting ramp cannot pass it. The horizon's share is
 * what a reviewer reads beside the fit, because a model whose ground region swallows the plant, or
 * whose sky region leaves almost no ground, is a misplaced line even when its fit is strong.
 */
export function soilMaskable(background: Background, height: number): boolean {
	if (background.horizon === null || background.ground === undefined) return false;
	const share = background.horizon / height;
	return (
		background.ground.fit >= SKY_MASK_FIT &&
		background.ground.noise <= SKY_MASK_NOISE &&
		share >= SOIL_MASK_EDGE &&
		share <= 1 - SOIL_MASK_EDGE
	);
}

/** A plant's outline in a picture, and the background it was taken from. */
export interface PlantMask {
	readonly width: number;
	readonly height: number;
	/** One byte per pixel: 1 where the plant is. */
	readonly mask: Uint8Array;
	/**
	 * One byte per pixel of the plant's coverage, from 0 for clear sky to 255 for a whole texel,
	 * where the picture gives it: a render's matte carries each texel's own coverage, where a
	 * photograph's colour mask carries only whether it is plant.
	 */
	readonly coverage?: Uint8Array;
	readonly background: Background;
	/**
	 * For a fitted ground: the CIEDE2000 distance between the plant's median colour and the soil's,
	 * so a reviewer sees how close the plant's own material stands to the ground model before
	 * trusting a mask that may merge them.
	 */
	readonly plantToGround?: number;
	/**
	 * The row where the outline ended at the horizon before its stem was followed down to its foot.
	 * The rows below it hold the stem's runs alone. Absent where no stem was followed.
	 */
	readonly footFollowedFrom?: number;
}

/** The pixels of the foreground's connected parts, 8-connected, labelled from 1; 0 is background. */
export function components(
	mask: Uint8Array,
	width: number,
	height: number,
): { labels: Int32Array; sizes: number[] } {
	const labels = new Int32Array(width * height);
	const sizes: number[] = [0];
	const stack: number[] = [];
	for (let start = 0; start < mask.length; start++) {
		if (!mask[start] || labels[start]) continue;
		const label = sizes.length;
		let size = 0;
		labels[start] = label;
		stack.push(start);
		while (stack.length > 0) {
			const at = stack.pop() as number;
			size++;
			const x = at % width;
			const y = (at - x) / width;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
					const next = ny * width + nx;
					if (mask[next] && !labels[next]) {
						labels[next] = label;
						stack.push(next);
					}
				}
		}
		sizes.push(size);
	}
	return { labels, sizes };
}

/** Pixels of background a run may cross to join another: the mask's own resolution, not a gap. */
export const PIECE_BRIDGE = 1;

/**
 * The number of separate pieces a plant is drawn as, where a piece is a connected run of at least
 * `minArea` pixels and two runs one background pixel apart count as one.
 *
 * A plant hangs together: every fruit meets its twig, every twig meets its limb. A part that meets
 * nothing is drawn as an island, and this counts it. Pieces smaller than `minArea` are ignored so
 * that a speck of background left by the outline's threshold is not read as a floating part.
 *
 * A single background pixel between two runs is the mask's resolution rather than a drawn gap: at
 * the work width a shoot's supporting twig is thinner than a pixel, so the pixel that would join it
 * falls to the outline's cutoff. Two runs a pixel apart are therefore one piece. The reference and
 * the render both come through this function, so the rule counts the two sides alike.
 */
/** One piece of a plant's outline: its area, its box, and whether it reaches the frame's border. */
export interface PlantPart {
	readonly area: number;
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	/** Whether the piece reaches the frame's border, where the part may run on outside the picture. */
	readonly border: boolean;
}

/**
 * The pieces that hang free, and the foot row the reading used.
 *
 * A plant that grows as a colony, such as a bracken patch, draws its fronds standing in the soil,
 * and the matte draws the plant alone against a plain ground: the join from a frond's foot into the
 * ground is one the picture can never show. A piece that meets the foot row where the plant stands
 * is therefore rooted in the soil and is not floating. Any other piece that the frame's border does
 * not carry meets nothing inside the picture.
 *
 * @param parts The pieces the matte carries, the largest run first.
 * @returns The foot row, and the pieces that hang free.
 */
export function hangingParts(
	parts: readonly PlantPart[],
	band?: { readonly top: number; readonly base: number },
): {
	readonly footRow: number;
	readonly parts: readonly PlantPart[];
} {
	let footRow = 0;
	for (const part of parts) footRow = Math.max(footRow, part.bottom);
	// The ground band is where the plant's own feet land: a colony's groups stand at different
	// depths, so one row would call the further groups floating.
	const low = band ? Math.min(band.top, band.base) : footRow;
	const high = band ? Math.max(band.top, band.base) : footRow;
	return {
		footRow,
		parts: parts
			.slice(1)
			.filter(
				(part) =>
					!part.border && (part.bottom < low - PIECE_BRIDGE || part.bottom > high + PIECE_BRIDGE),
			),
	};
}

/**
 * The separate pieces a plant is drawn as: runs of at least `minArea` pixels, with two runs one
 * background pixel apart counted as one. A plant hangs together: every fruit meets its twig, every
 * twig meets its limb. A part that meets nothing is drawn as an island, and this returns it with its
 * box so a reader can name it. A single background pixel between two runs is the mask's resolution
 * rather than a drawn gap, so two runs a pixel apart are one piece.
 *
 * @param mask The picture's plant mask, one byte a pixel.
 * @param width The mask's width in pixels.
 * @param height The mask's height in pixels.
 * @param minArea The smallest run that counts, so an outline's speckle is not a piece.
 * @returns Every piece's area and box.
 */
export function pieceParts(
	mask: Uint8Array,
	width: number,
	height: number,
	minArea: number,
	bridge = PIECE_BRIDGE,
): PlantPart[] {
	const { labels, sizes } = components(mask, width, height);
	const parent = new Int32Array(sizes.length);
	for (let label = 0; label < parent.length; label++) parent[label] = label;
	const find = (from: number): number => {
		let root = from;
		while ((parent[root] as number) !== root) root = parent[root] as number;
		let at = from;
		while ((parent[at] as number) !== root) {
			const next = parent[at] as number;
			parent[at] = root;
			at = next;
		}
		return root;
	};
	const join = (a: number, b: number): void => {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
	};
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			if (labels[y * width + x]) continue;
			let near = 0;
			for (let dy = -bridge; dy <= bridge; dy++)
				for (let dx = -bridge; dx <= bridge; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
					const label = labels[ny * width + nx] as number;
					if (!label) continue;
					if (near === 0) near = label;
					else join(near, label);
				}
		}
	const boxes = new Map<
		number,
		{ area: number; left: number; top: number; right: number; bottom: number; border: boolean }
	>();
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const label = labels[y * width + x] as number;
			if (!label) continue;
			const root = find(label);
			const box = boxes.get(root) ?? {
				area: 0,
				left: x,
				top: y,
				right: x,
				bottom: y,
				border: false,
			};
			box.area++;
			box.left = Math.min(box.left, x);
			box.top = Math.min(box.top, y);
			box.right = Math.max(box.right, x);
			box.bottom = Math.max(box.bottom, y);
			if (x === 0 || y === 0 || x === width - 1 || y === height - 1) box.border = true;
			boxes.set(root, box);
		}
	return [...boxes.values()]
		.filter((box) => box.area >= minArea)
		.map(({ area, left, top, right, bottom, border }) => ({
			area,
			left,
			top,
			right,
			bottom,
			border,
		}))
		.sort((a, b) => b.area - a.area);
}

/**
 * The number of separate pieces a plant is drawn as, where a piece is a connected run of at least
 * `minArea` pixels and two runs one background pixel apart count as one.
 *
 * A plant hangs together: every fruit meets its twig, every twig meets its limb. A part that meets
 * nothing is drawn as an island, and this counts it. Pieces smaller than `minArea` are ignored so
 * that a speck of background left by the outline's threshold is not read as a floating part.
 *
 * A single background pixel between two runs is the mask's resolution rather than a drawn gap: at
 * the work width a shoot's supporting twig is thinner than a pixel, so the pixel that would join it
 * falls to the outline's cutoff. Two runs a pixel apart are therefore one piece. The reference and
 * the render both come through this function, so the rule counts the two sides alike.
 */
export function pieceCount(
	mask: Uint8Array,
	width: number,
	height: number,
	minArea: number,
): number {
	return pieceParts(mask, width, height, minArea).length;
}

/** The CIELAB distance from a colour to the nearest blend of two others. */ export function distanceToSegment(
	point: readonly number[],
	from: readonly number[],
	to: readonly number[],
): number {
	const d = [0, 1, 2].map((c) => (to[c] as number) - (from[c] as number));
	const p = [0, 1, 2].map((c) => (point[c] as number) - (from[c] as number));
	const length = d.reduce((sum, v) => sum + v * v, 0);
	const t =
		length > 0
			? Math.max(0, Math.min(1, d.reduce((sum, v, c) => sum + v * (p[c] as number), 0) / length))
			: 0;
	return deltaE76(
		point,
		[0, 1, 2].map((c) => (from[c] as number) + t * (d[c] as number)),
	);
}

/** The pixel distance below which a colour counts as the background, from the surface's noise. */
function threshold(surface: ColourSurface, floor: number, spread: number): number {
	return Math.max(floor, surface.noise * spread);
}

/**
 * Whether a colour below the horizon reads as the meadow in shade: darker than the meadow, with
 * about its hue and a good share of its colourfulness. A trunk is browner or greyer than that.
 */
export function shadowLike(pixel: readonly number[], meadow: readonly number[]): boolean {
	const chroma = Math.hypot(pixel[1] ?? 0, pixel[2] ?? 0);
	const meadowChroma = Math.hypot(meadow[1] ?? 0, meadow[2] ?? 0);
	if ((pixel[0] ?? 0) >= (meadow[0] ?? 0) || meadowChroma < 6) return false;
	const hue = Math.atan2(pixel[2] ?? 0, pixel[1] ?? 0);
	const meadowHue = Math.atan2(meadow[2] ?? 0, meadow[1] ?? 0);
	let turn = Math.abs(hue - meadowHue);
	if (turn > Math.PI) turn = 2 * Math.PI - turn;
	return turn < (25 * Math.PI) / 180 && chroma > meadowChroma * 0.35;
}

/**
 * From a row down, keeps only the plant that hangs down from the plant above it, row by row. Below
 * the horizon it also stops where the colour turns to the meadow in shade: a ground shadow is a
 * darker meadow that spreads sideways from the trunk's foot, and the meadow's texture never joins
 * the plant from above. In a frame with no horizon, the same rule over the lowest rows drops a sliver
 * of ground that shows along the frame's foot.
 */
export function keepHangingParts(
	mask: Uint8Array,
	lab: Float32Array,
	width: number,
	height: number,
	from: number,
	ground?: ColourSurface,
): void {
	for (let y = Math.max(1, from); y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = y * width + x;
			if (!mask[at]) continue;
			const above = at - width;
			const hangs =
				mask[above] === 1 ||
				(x > 0 && mask[above - 1] === 1) ||
				(x < width - 1 && mask[above + 1] === 1);
			const pixel = [lab[at * 3] as number, lab[at * 3 + 1] as number, lab[at * 3 + 2] as number];
			const shade = ground ? shadowLike(pixel, surfaceAt(ground, x / width, y / height)) : false;
			mask[at] = hangs && !shade ? 1 : 0;
		}
}

/** The share of a frame's height, at its foot, that the hanging rule covers when no horizon shows. */
const FOOT_SHARE = 0.03;

/**
 * The plant's outline in a picture with a plain background or a fitted sky, in the work picture's
 * pixels. The picture is first shrunk to the work width. Returns a mask with no plant when the
 * border is neither plain nor a sky the surface fit models (see `skyMaskable`).
 */
export function plantMask(image: Rgba, workWidth = WORK_WIDTH): PlantMask {
	const work = image.width > workWidth ? resizeToWidth(image, workWidth) : image;
	const { width, height } = work;
	const lab = labImage(work);
	const background = backgroundOf(lab, width, height);
	const mask = new Uint8Array(width * height);
	if (!background.plain && !skyMaskable(background) && !soilMaskable(background, height))
		return { width, height, mask, background };
	const horizon = background.horizon ?? height;
	// A fitted sky or ground is trusted only where it finds a plausible subject. A picture of
	// something else against a natural backdrop, such as bark or foliage, still admits a smooth
	// surface on its border, and the surface then marks a few textured specks as the plant. A
	// subject that a fitted background finds under a fiftieth of the frame is that failure, not a
	// plant: every real reference's subject fills more.
	const MIN_FITTED_PLANT_SHARE = 0.02;
	// A plain background's spread was tuned against studio paper; a fitted sky or ground carries a
	// wider residual, so its limit takes fewer spreads or the plant itself falls inside it.
	const skyLimit = threshold(background.sky, 8, background.plain ? 3.5 : 2);
	const groundLimit = background.ground
		? threshold(background.ground, 10, background.plain ? 3 : 2)
		: skyLimit;
	// The rows at the horizon blend the sky with the meadow, so there a pixel is background when it
	// lies near any blend of the two.
	const band = Math.max(1, Math.round(height * 0.006));
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = y * width + x;
			const pixel = [lab[at * 3] as number, lab[at * 3 + 1] as number, lab[at * 3 + 2] as number];
			const below = y >= horizon && background.ground;
			const surface = below ? (background.ground as ColourSurface) : background.sky;
			const own = surfaceAt(surface, x / width, y / height);
			let d = deltaE76(own, pixel);
			if (background.ground && Math.abs(y - horizon) <= band) {
				const sky = surfaceAt(background.sky, x / width, y / height);
				const ground = surfaceAt(background.ground, x / width, y / height);
				d = Math.min(d, distanceToSegment(pixel, sky, ground));
			}
			mask[at] = d > (below ? groundLimit : skyLimit) ? 1 : 0;
		}
	clearSideBands(mask, lab, width, height, horizon);
	if (
		background.ground &&
		(plantGroundDistance(mask, lab, background.ground, horizon, height) ?? 0) >=
			LIFTED_GROUND_DISTINCT
	)
		clearLiftedGround(mask, lab, width, height, horizon, background, skyLimit, groundLimit);
	if (background.ground) keepHangingParts(mask, lab, width, height, horizon, background.ground);
	else
		keepHangingParts(
			mask,
			lab,
			width,
			height,
			height - Math.max(2, Math.round(height * FOOT_SHARE)),
		);
	keepPlantParts(mask, width, height, horizon);
	// A silhouette stands on a black ground line, which holds no foot to tell from its ground.
	const footFollowedFrom =
		background.ground &&
		(surfaceAt(background.ground, 0.5, (horizon / height + 1) / 2)[0] as number) > FOOT_GROUND_LIGHT
			? followStemFoot({ width, height, mask, background }, lab)
			: undefined;
	if (!background.plain) {
		let kept = 0;
		for (let at = 0; at < mask.length; at++) kept += mask[at] as number;
		if (kept / (width * height) < MIN_FITTED_PLANT_SHARE) mask.fill(0);
	}
	const plantToGround = background.ground
		? plantGroundDistance(mask, lab, background.ground, horizon, height)
		: undefined;
	return {
		width,
		height,
		mask,
		background,
		...(plantToGround !== undefined ? { plantToGround } : {}),
		...(footFollowedFrom !== undefined ? { footFollowedFrom } : {}),
	};
}

/**
 * The CIEDE2000 distance between the median colour of a mask's plant and the ground at the middle
 * of the ground's band, or undefined where the mask holds no plant.
 */
function plantGroundDistance(
	mask: Uint8Array,
	lab: Float32Array,
	ground: ColourSurface,
	horizon: number,
	height: number,
): number | undefined {
	const channels: number[][] = [[], [], []];
	for (let at = 0; at < mask.length; at++)
		if (mask[at])
			for (let c = 0; c < 3; c++) (channels[c] as number[]).push(lab[at * 3 + c] as number);
	if ((channels[0] as number[]).length === 0) return undefined;
	const median = channels.map((values) => {
		values.sort((a, b) => a - b);
		return values[values.length >> 1] ?? 0;
	});
	return Number(deltaE2000(median, surfaceAt(ground, 0.5, (horizon / height + 1) / 2)).toFixed(2));
}

/**
 * The least CIEDE2000 distance between a plant's colour and its ground's for the ground's lifted
 * edge to be cleared: a plant that far from the ground's colour is not taken for it, where a bark
 * of the litter's own colour would lose the sides of its flaring foot.
 */
const LIFTED_GROUND_DISTINCT = 20;

/**
 * How far above the horizon's row, as a share of the frame's height, a ground's own top edge may
 * stand: a ploughed field's clods or a field's slope lift its edge a few rows above the one straight
 * row the horizon is found at.
 */
const GROUND_LIFT = 0.03;

/**
 * Clears the ground's top edge where it stands above the horizon's row. Up each column from the
 * horizon runs the edge: pixels that the ground's surface holds, that read as the ground in shade,
 * such as the plant's own shadow along the edge, or that lie near a blend of the ground with the
 * sky. The run is the ground's only where the sky stands on it within a few rows. A run that meets
 * the plant, or climbs on past those rows, as a pale trunk or a skirt of dark leaves does, is the
 * plant's own foot and stays.
 */
function clearLiftedGround(
	mask: Uint8Array,
	lab: Float32Array,
	width: number,
	height: number,
	horizon: number,
	background: Background,
	skyLimit: number,
	groundLimit: number,
): void {
	const ground = background.ground;
	if (!ground) return;
	const highest = Math.max(0, horizon - Math.max(1, Math.round(height * GROUND_LIFT)));
	for (let x = 0; x < width; x++)
		for (let y = horizon - 1; y >= highest; y--) {
			const at = y * width + x;
			const pixel = [lab[at * 3] as number, lab[at * 3 + 1] as number, lab[at * 3 + 2] as number];
			const sky = surfaceAt(background.sky, x / width, y / height);
			if (deltaE76(sky, pixel) <= skyLimit) {
				for (let r = y + 1; r < horizon; r++) mask[r * width + x] = 0;
				break;
			}
			const own = surfaceAt(ground, x / width, y / height);
			const edge =
				deltaE76(own, pixel) <= groundLimit ||
				shadowLike(pixel, own) ||
				distanceToSegment(pixel, sky, own) <= groundLimit;
			if (!edge) break;
		}
}

/** The least CIELAB lightness of a ground on which a foot can be told from it. */
const FOOT_GROUND_LIGHT = 12;
/** The rows above the outline's end that give the stem's place, width and colour. */
const FOOT_STEM_ROWS = 6;
/** The most of the plant's width that the outline's last rows may span and still be a stem. */
export const FOOT_STEM_SHARE = 0.25;
/** The least CIELAB distance between the stem's colour and the ground beside it. */
const FOOT_CONTRAST = 6;
/** The most of that distance that a pixel of the stem may stand from the stem's own colour. */
const FOOT_STEM_NEAR = 0.6;
/** How far a row's run may reach past the run above it, each side, in stem widths: a root flare. */
const FOOT_GROW = 0.25;
/** The least and the most of the stem's width that a row's run may be. */
const FOOT_RUN_LEAST = 0.5;
const FOOT_RUN_MOST = 3;
/** How much of a row's colour the stem's colour takes on, so a foot that darkens is still stem. */
const FOOT_COLOUR_FOLLOWS = 0.3;
/** The rows on end that may fail before the stem has ended. */
const FOOT_MISSES = 3;

/**
 * Each row's run of plant nearest the axis: its first and last column, or -1 for an empty row.
 * Below the crown the run is the stem, apart from the boughs and the foliage that hang beside it.
 */
export function axisRuns(mask: Uint8Array, width: number, box: Box, axis: number): Int32Array {
	const runs = new Int32Array((box.bottom + 1) * 2).fill(-1);
	for (let y = box.top; y <= box.bottom; y++) {
		let start = -1;
		let nearest = Number.POSITIVE_INFINITY;
		for (let x = box.left; x <= box.right + 1; x++) {
			const on = x <= box.right && mask[y * width + x] !== 0;
			if (on && start < 0) start = x;
			if (!on && start >= 0) {
				const end = x - 1;
				const distance = axis < start ? start - axis : axis > end ? axis - end : 0;
				if (distance < nearest) {
					nearest = distance;
					runs[y * 2] = start;
					runs[y * 2 + 1] = end;
				}
				start = -1;
			}
		}
	}
	return runs;
}

/** What following a stem below the horizon gives. */
export type Followed =
	| {
			readonly kind: 'stem';
			/** The row where the stem ends. */
			readonly foot: number;
			/** Each followed row's first and last column, from the row below the outline's last. */
			readonly runs: readonly (readonly [number, number])[];
	  }
	| { readonly kind: 'mass' }
	| { readonly kind: 'none' };

/** The mean colour of a run of pixels in a row, or null for a run off the frame. */
function rowColour(
	lab: Float32Array,
	width: number,
	y: number,
	from: number,
	to: number,
): number[] | null {
	const left = Math.max(0, from);
	const right = Math.min(width - 1, to);
	if (right < left) return null;
	const sum = [0, 0, 0];
	for (let x = left; x <= right; x++)
		for (let c = 0; c < 3; c++)
			sum[c] = (sum[c] as number) + (lab[(y * width + x) * 3 + c] as number);
	return sum.map((v) => v / (right - left + 1));
}

/**
 * Follows a stem down from the last row of an outline.
 *
 * @param lab The picture's CIELAB colours at the mask's size.
 * @param width The mask's width.
 * @param height The mask's height.
 * @param mask The plant's outline.
 * @param box The plant's box.
 * @param axis The column of the plant's foot.
 * @returns The row where the stem ends with each followed row's run; `mass` where the outline's
 *   last rows are too wide to be a stem; `none` where no stem runs on below the outline.
 */
export function followStem(
	lab: Float32Array,
	width: number,
	height: number,
	mask: Uint8Array,
	box: Box,
	axis: number,
): Followed {
	const runs = axisRuns(mask, width, box, axis);
	const lefts: number[] = [];
	const rights: number[] = [];
	const colour = [0, 0, 0];
	let pixels = 0;
	for (let y = box.bottom; y > Math.max(box.top, box.bottom - FOOT_STEM_ROWS); y--) {
		const from = runs[y * 2] as number;
		if (from < 0) continue;
		const to = runs[y * 2 + 1] as number;
		lefts.push(from);
		rights.push(to);
		for (let x = from; x <= to; x++) {
			for (let c = 0; c < 3; c++)
				colour[c] = (colour[c] as number) + (lab[(y * width + x) * 3 + c] as number);
			pixels++;
		}
	}
	if (pixels === 0) return { kind: 'none' };
	lefts.sort((a, b) => a - b);
	rights.sort((a, b) => a - b);
	let left = lefts[lefts.length >> 1] as number;
	let right = rights[rights.length >> 1] as number;
	const across = right - left + 1;
	if (across > (box.right - box.left + 1) * FOOT_STEM_SHARE) return { kind: 'mass' };
	let stem = colour.map((v) => v / pixels);
	const beside = Math.max(3, across);
	const gap = Math.max(1, Math.round(across / 4));
	const grow = Math.max(1, Math.round(across * FOOT_GROW));
	const blur = Math.max(1, Math.round(across / 4));
	const followed: [number, number][] = [];
	let foot = box.bottom;
	let misses = 0;
	for (let y = box.bottom + 1; y < height && misses < FOOT_MISSES; y++) {
		const from = Math.max(0, left - grow);
		const to = Math.min(width - 1, right + grow);
		// The ground on each side of the row's reach; a side off the frame is left out.
		const grounds = [
			rowColour(lab, width, y, from - gap - beside, from - gap - 1),
			rowColour(lab, width, y, to + gap + 1, to + gap + beside),
		].filter((ground): ground is number[] => ground !== null);
		const ground =
			grounds.length === 0 ? 0 : Math.min(...grounds.map((side) => deltaE76(stem, side)));
		// The run of stem-coloured pixels that lies most under the run above; one pixel bridges.
		let best: [number, number] | null = null;
		let bestOver = 0;
		let start = -1;
		let last = -1;
		const close = (): void => {
			if (start < 0) return;
			const over = Math.min(last, right) - Math.max(start, left) + 1;
			if (over > bestOver) {
				bestOver = over;
				best = [start, last];
			}
			start = -1;
		};
		if (ground >= FOOT_CONTRAST)
			for (let x = from; x <= to; x++) {
				// Bark is mottled, so a pixel is read with its neighbours across half a stem's width.
				const here = rowColour(lab, width, y, x - blur, x + blur) as number[];
				if (deltaE76(stem, here) >= ground * FOOT_STEM_NEAR) continue;
				if (start >= 0 && x - last > 2) close();
				if (start < 0) start = x;
				last = x;
			}
		close();
		let run = best as [number, number] | null;
		const length = run ? run[1] - run[0] + 1 : 0;
		// A run that covers less than half the run above it has stepped off the stem to one side.
		if (
			!run ||
			length < Math.max(2, across * FOOT_RUN_LEAST) ||
			length > across * FOOT_RUN_MOST ||
			bestOver * 2 < right - left + 1
		) {
			// A foot whose bark is too mottled to hold pixel by pixel can still hold as a whole: the
			// column under the run above, taken together, against the ground beside it.
			run = null;
			let least = Number.POSITIVE_INFINITY;
			for (const shift of [0, -1, 1]) {
				const inside = rowColour(lab, width, y, left + shift, right + shift);
				const sides = [
					rowColour(lab, width, y, left + shift - gap - beside, left + shift - gap - 1),
					rowColour(lab, width, y, right + shift + gap + 1, right + shift + gap + beside),
				].filter((side): side is number[] => side !== null);
				if (!inside || sides.length === 0) continue;
				const apart = Math.min(...sides.map((side) => deltaE76(stem, side)));
				const off = deltaE76(stem, inside);
				if (apart >= FOOT_CONTRAST && off < apart * FOOT_STEM_NEAR && off < least) {
					least = off;
					run = [Math.max(0, left + shift), Math.min(width - 1, right + shift)];
				}
			}
		}
		if (!run) {
			misses++;
			continue;
		}
		// Rows that failed between two that hold are the stem too: they take the run below them.
		for (let k = 0; k <= misses; k++) followed.push(run);
		misses = 0;
		left = run[0];
		right = run[1];
		foot = y;
		const here = rowColour(lab, width, y, left, right) as number[];
		stem = stem.map((v, c) => v + ((here[c] as number) - v) * FOOT_COLOUR_FOLLOWS);
	}
	return foot > box.bottom ? { kind: 'stem', foot, runs: followed } : { kind: 'none' };
}

/** The share of the plant's height, from the ground, in which thin horizontal runs are dropped. */
const LOW_SHARE = 0.2;
/** The least run up and down, as a share of the plant's height, through a pixel of that share. */
const LOW_RUN = 1 / 32;

/**
 * A mask without the thin horizontal runs of the plant's lowest share: a pixel there stays only
 * where the outline runs a set share of the plant's height up or down through it, as a trunk or a
 * tuft does and a horizon line or a ground strip does not.
 */
export function dropThinLowRuns(plant: PlantMask, box: Box): PlantMask {
	const { width, height } = plant;
	const tall = box.bottom - box.top + 1;
	const run = Math.max(2, Math.round(LOW_RUN * tall));
	const from = box.bottom - Math.round(LOW_SHARE * tall);
	const mask = plant.mask.slice();
	for (let y = Math.max(0, from); y <= box.bottom; y++)
		for (let x = 0; x < width; x++) {
			const at = y * width + x;
			if (!plant.mask[at]) continue;
			let length = 1;
			for (let d = 1; d < run && y + d < height && plant.mask[at + d * width]; d++) length++;
			for (let d = 1; d < run && y - d >= 0 && plant.mask[at - d * width]; d++) length++;
			if (length < run) mask[at] = 0;
		}
	keepPlantParts(mask, width, height, plant.background.horizon ?? height);
	return { ...plant, mask };
}

/** The share of the outline's height, from its lowest row up, whose runs place the stem's column. */
const FOOT_AXIS_BAND = 0.15;

/**
 * The stem's column: the middle value of the centres of each row's run nearest the outline's middle,
 * over the outline's lowest rows. A row at the horizon blends the sky with the ground and can hold a
 * speck wider than the stem, and a low bough can sweep out beside it, so no one row decides.
 */
function stemColumn(mask: Uint8Array, width: number, box: Box): number {
	const runs = axisRuns(mask, width, box, (box.left + box.right) / 2);
	const band = Math.max(2, Math.round((box.bottom - box.top + 1) * FOOT_AXIS_BAND));
	const centres: number[] = [];
	for (let y = box.bottom; y > Math.max(box.top - 1, box.bottom - band); y--)
		if ((runs[y * 2] as number) >= 0)
			centres.push(((runs[y * 2] as number) + (runs[y * 2 + 1] as number)) / 2);
	centres.sort((a, b) => a - b);
	return centres[centres.length >> 1] ?? (box.left + box.right) / 2;
}

/**
 * Follows a stem from the outline's lowest row down to its foot, in the mask. The ground's fitted
 * colour cannot tell a dark foot from dark ground, so an outline can end at the horizon, or in the
 * ground below it, while the stem runs on to its root collar, and every figure that is a share of the
 * plant's height then counts from the wrong base. The stem is read on the outline without the thin
 * runs along its foot, a horizon line or a strip of grass that the mask kept, and `followStem`
 * follows it down from its column; the followed rows join the mask.
 *
 * @returns The row where the stem's outline ended before it was followed, or undefined where no
 *   stem was followed.
 */
function followStemFoot(plant: PlantMask, lab: Float32Array): number | undefined {
	const { mask, width, height } = plant;
	const whole = boxOf(mask, width, height);
	if (!whole) return undefined;
	const cleaned = dropThinLowRuns(plant, whole).mask;
	const box = boxOf(cleaned, width, height);
	// An outline that ends above the horizon stands on its own foot.
	const horizon = plant.background.horizon ?? height;
	if (!box || box.bottom < horizon - Math.max(2, Math.round(height * 0.01))) return undefined;
	// The stem is followed from its own lowest row, which a speck beside it can stand below; the
	// followed rows then join the stem and are not a loose piece under the speck.
	const column = stemColumn(cleaned, width, box);
	const runs = axisRuns(cleaned, width, box, column);
	const holds = (y: number): boolean =>
		(runs[y * 2] as number) >= 0 &&
		(runs[y * 2] as number) <= column + 1 &&
		(runs[y * 2 + 1] as number) >= column - 1;
	let last = box.bottom;
	while (last > box.top && !holds(last)) last--;
	const stem = followStem(lab, width, height, cleaned, { ...box, bottom: last }, column);
	if (stem.kind !== 'stem') return undefined;
	// The followed rows would hold up a horizon line or a strip of grass beside them, so the mask
	// takes the cleaned rows before the stem joins it.
	mask.set(cleaned);
	stem.runs.forEach(([from, to], k) => {
		mask.fill(1, (last + 1 + k) * width + from, (last + 1 + k) * width + to + 1);
	});
	return last;
}

/** How far above the horizon, as a share of the frame's height, a background band may lie. */
const SIDE_BAND_REACH = 0.25;
/** The CIELAB distance from the colour at the frame's side within which a band runs on. */
const SIDE_BAND_COLOUR = 18;

/** The most rows, as a share of the frame's height, of a strip that reaches only one side. */
const SIDE_STRIP_ROWS = 0.04;

/**
 * Clears the background bands that the sky's and the meadow's surfaces miss, such as a river or a
 * far bank along the horizon. Near or below the horizon, a row whose outline reaches both sides of
 * the frame holds such a band, since a plant in frame reaches at most one; so does a thin run of
 * rows that reaches one side once those are cleared, where a plant running off the frame reaches
 * it over many rows. In each such row, the run in from each side it reaches is cleared while its
 * colour stays near the colour at that side.
 */
export function clearSideBands(
	mask: Uint8Array,
	lab: Float32Array,
	width: number,
	height: number,
	horizon: number,
): void {
	const sample = Math.max(2, Math.round(width * 0.01));
	const from = Math.max(0, horizon - Math.round(height * SIDE_BAND_REACH));
	const thin = Math.max(2, Math.round(height * SIDE_STRIP_ROWS));
	const left = (y: number) => mask[y * width] === 1;
	const right = (y: number) => mask[y * width + width - 1] === 1;
	for (let y = from; y < height; y++)
		if (left(y) && right(y)) clearSideRuns(mask, lab, width, y, sample);
	for (let y = from; y < height; ) {
		if (!left(y) && !right(y)) {
			y++;
			continue;
		}
		let end = y;
		while (end < height && (left(end) || right(end))) end++;
		if (end - y <= thin) for (let r = y; r < end; r++) clearSideRuns(mask, lab, width, r, sample);
		y = end;
	}
}

/**
 * Clears a band's pixels along a row, in from each side of the frame it reaches: those whose colour
 * stays near the colour at that side, up to the first stretch of other colours as wide as a
 * hundredth of the frame, which is the plant. Shorter stretches between band pixels are the band's
 * own texture and go with it.
 */
function clearSideRuns(
	mask: Uint8Array,
	lab: Float32Array,
	width: number,
	y: number,
	sample: number,
): void {
	const row = y * width;
	for (const [start, step] of [
		[0, 1],
		[width - 1, -1],
	] as const) {
		if (!mask[row + start]) continue;
		const seed = [0, 0, 0];
		let n = 0;
		for (let k = 0, x = start; k < sample && mask[row + x]; k++, x += step) {
			for (let c = 0; c < 3; c++)
				seed[c] = (seed[c] as number) + (lab[(row + x) * 3 + c] as number);
			n++;
		}
		for (let c = 0; c < 3; c++) seed[c] = (seed[c] as number) / n;
		const pending: number[] = [];
		for (let x = start; x >= 0 && x < width && pending.length < sample; x += step) {
			if (!mask[row + x]) continue;
			const at = (row + x) * 3;
			const pixel = [lab[at] as number, lab[at + 1] as number, lab[at + 2] as number];
			if (deltaE76(pixel, seed) > SIDE_BAND_COLOUR) {
				pending.push(row + x);
				continue;
			}
			for (const p of pending) mask[p] = 0;
			pending.length = 0;
			mask[row + x] = 0;
		}
	}
}

/**
 * Keeps the plant in a mask: its largest part, and the small parts near it above the horizon,
 * which are leaf clumps that the sky cut off. Parts wholly below the horizon that do not join it
 * are the meadow's own texture.
 */
export function keepPlantParts(
	mask: Uint8Array,
	width: number,
	height: number,
	horizon: number,
): void {
	const { labels, sizes } = components(mask, width, height);
	let main = 0;
	for (let label = 1; label < sizes.length; label++)
		if ((sizes[label] as number) > (sizes[main] as number)) main = label;
	if (main === 0) return;
	const boxes = sizes.map(() => [width, height, -1, -1]);
	for (let at = 0; at < labels.length; at++) {
		const label = labels[at] as number;
		if (!label) continue;
		const x = at % width;
		const y = (at - x) / width;
		const box = boxes[label] as number[];
		box[0] = Math.min(box[0] as number, x);
		box[1] = Math.min(box[1] as number, y);
		box[2] = Math.max(box[2] as number, x);
		box[3] = Math.max(box[3] as number, y);
	}
	const mainBox = boxes[main] as number[];
	const margin = Math.round(width * 0.05);
	const keep = sizes.map((size, label) => {
		if (label === main) return true;
		const box = boxes[label] as number[];
		const minimum = Math.max(4, (sizes[main] as number) * 0.0005);
		const near =
			(box[2] as number) >= (mainBox[0] as number) - margin &&
			(box[0] as number) <= (mainBox[2] as number) + margin &&
			(box[3] as number) >= (mainBox[1] as number) - margin &&
			(box[1] as number) <= (mainBox[3] as number) + margin;
		return size >= minimum && near && (box[1] as number) < horizon;
	});
	for (let at = 0; at < labels.length; at++)
		mask[at] = keep[labels[at] as number] && labels[at] ? 1 : 0;
}

/**
 * How a plant stands, where that changes how its outline is read: a mound of leaves from its foot,
 * or a clump of several bare stems from one stool.
 */
export type PlantHabit = 'mound' | 'clump';

/**
 * A silhouette photograph's plant mask read as the drawn matte is read: a texel is plant only where
 * it is darker than half, so a texel the plant covers in part counts as the sky it mostly shows.
 * The photograph's own mask counts any texel the plant darkens at all, which closes a crown's small
 * gaps where the matte keeps them, and the two sides of a gap figure would then be read by two
 * rules. The mask keeps its own handling of the ground band and the frame's sides.
 *
 * @param plant The photograph's plant mask.
 * @param image The photograph, at any size: it is read at the mask's.
 * @returns The mask with every texel lighter than half cleared.
 */
export function halfDarkMask(plant: PlantMask, image: Rgba): PlantMask {
	const work = image.width > plant.width ? resizeToWidth(image, plant.width) : image;
	const mask = new Uint8Array(plant.mask);
	for (let at = 0; at < mask.length; at++) {
		if (!mask[at]) continue;
		const luma =
			0.2126 * (work.data[at * 4] as number) +
			0.7152 * (work.data[at * 4 + 1] as number) +
			0.0722 * (work.data[at * 4 + 2] as number);
		if (luma >= 128) mask[at] = 0;
	}
	return { ...plant, mask };
}

/** The plant's outline from a matte: the plant drawn dark on white, as the silhouette view draws it. */
export function matteMask(image: Rgba): PlantMask {
	const work = image.width > WORK_WIDTH ? resizeToWidth(image, WORK_WIDTH) : image;
	const { width, height } = work;
	const mask = new Uint8Array(width * height);
	const coverage = new Uint8Array(width * height);
	for (let at = 0; at < mask.length; at++) {
		const luma =
			0.2126 * (work.data[at * 4] as number) +
			0.7152 * (work.data[at * 4 + 1] as number) +
			0.0722 * (work.data[at * 4 + 2] as number);
		mask[at] = luma < 128 ? 1 : 0;
		// The clear sky reads white, and the matte's frame edge reads one step below it. A texel at
		// that step or above is clear, so the frame's own edge is not taken for a faint leaf.
		coverage[at] = luma >= 254 ? 0 : Math.round(255 - luma);
	}
	const flat: ColourSurface = {
		coefficients: [
			[100, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0],
		],
		noise: 0.5,
		fit: 1,
	};
	return { width, height, mask, coverage, background: { horizon: null, sky: flat, plain: true } };
}

/**
 * The outline that the piece test reads: every texel that a leaf covers at all, however little,
 * since a part joins the mass through the one texel between them. A picture without coverage
 * gives its mask unchanged.
 */
export function anyPlantMask(plant: PlantMask): Uint8Array {
	const coverage = plant.coverage;
	if (!coverage) return plant.mask;
	const mask = new Uint8Array(coverage.length);
	for (let at = 0; at < coverage.length; at++) mask[at] = coverage[at] ? 1 : 0;
	return mask;
}

/**
 * A matte's own coverage mask at the picture's width, read by the same any-coverage rule the piece
 * test uses. The gate reads this mask, because a downscale to the work width can drop a hairline
 * shoot that the picture itself keeps, and so invent a piece that hangs free.
 *
 * @param image The matte picture, at the size the run drew it.
 * @returns The picture's width and height with one byte per texel, 1 where any leaf covers it.
 */
export function matteOwnMask(image: Rgba): {
	readonly width: number;
	readonly height: number;
	readonly mask: Uint8Array;
} {
	const { width, height } = image;
	const mask = new Uint8Array(width * height);
	for (let at = 0; at < mask.length; at++) {
		const luma =
			0.2126 * (image.data[at * 4] as number) +
			0.7152 * (image.data[at * 4 + 1] as number) +
			0.0722 * (image.data[at * 4 + 2] as number);
		mask[at] = luma < 254 ? 1 : 0;
	}
	return { width, height, mask };
}

/** A box of pixels, edges included. */
export interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/**
 * The shares of its picture's frame that a plant's subject box takes, for a view that frames by the
 * box, or undefined where the picture's outline does not separate: a void box, or an outline the
 * reference set names as not separable (a fitted ground that is the subject itself, or the band
 * behind it). A view that receives no shares keeps its own frame, so a void outline never moves it.
 */
export function subjectShares(
	width: number,
	height: number,
	box: Box | null | undefined,
	separable: boolean,
): { readonly width: number; readonly height: number } | undefined {
	if (!separable || !box || width <= 0 || height <= 0) return undefined;
	const across = (box.right - box.left) / width;
	const down = (box.bottom - box.top) / height;
	if (!(across > 0 && across <= 1 && down > 0 && down <= 1)) return undefined;
	return { width: across, height: down };
}

/**
 * The green of a leaf in CIELAB a*, below which a pixel or a picture's greener cluster reads as
 * foliage rather than bark. Leaves and the barks measured across the corpus stand apart at this
 * bound. The crown foliage share fits its two clusters to each picture, and uses the bound only to
 * refuse a fit whose greener cluster is not green, so a bare tree's browns read as no foliage
 * rather than a guess.
 */
export const LEAF_GREEN = -5;

/** The crown's box in the work picture: the columns and rows its plant pixels span. */
export interface CrownRegion {
	readonly left: number;
	/** The crown's highest row, the top of the plant's box. */
	readonly top: number;
	readonly right: number;
	/** The crown's lowest row, where the crown starts above the bare stem. */
	readonly bottom: number;
}

/** The measures a reviewer reads from a plant's outline. Rows count down, shares run 0 to 1. */
export interface PlantMeasures {
	/** The work picture's size. */
	readonly width: number;
	readonly height: number;
	/** The horizon's row share, or null. */
	readonly horizon: number | null;
	/** The plant's box in the work picture, or null when the mask holds no plant. */
	readonly box: Box | null;
	/** Which edges of the frame the plant touches, so its box is cut there. */
	readonly clipped: {
		readonly left: boolean;
		readonly top: boolean;
		readonly right: boolean;
		readonly bottom: boolean;
	};
	/** The plant's width in each of the profile's height bands, top band first, over its height. */
	readonly widthProfile: readonly number[];
	/** Where the crown starts, as a share of the plant's height up from its base. */
	readonly crownStart: number;
	/** The crown's box: its widest run and its height to the crown's start, in work pixels. */
	readonly crownBox: { readonly width: number; readonly height: number };
	/** The columns and rows that hold the crown's plant pixels, or null for a picture with no plant. */
	readonly crownRegion: CrownRegion | null;
	/** The share of the crown's outline that shows background: the sky or ground through it. */
	readonly gapFraction: number;
	/**
	 * The same gap with each clear texel of a render's matte counted by its clear share. A
	 * photograph's outline has no such share, so the two sides of a pair are compared on
	 * `gapFraction`, where a texel is sky or plant on both. This reading is kept beside it for a
	 * render, since earlier figures were read this way; null for a picture with no coverage.
	 */
	readonly gapByCoverage: number | null;
	/** The share of the crown's box that shows background: the figure the plant is judged on. */
	readonly crownBoxGap: number;
	/**
	 * The share of the whole picture that shows background. It widens with the empty sky a
	 * photograph keeps around its plant, so it is reported beside the crown-box figure rather
	 * than in place of it.
	 */
	readonly frameGap: number;
	/** The share of the plant's box that the plant covers. */
	readonly solidity: number;
	/** The mean CIELAB colour of the crown's foliage, and its sRGB hex. */
	readonly foliage: { readonly lab: readonly number[]; readonly hex: string } | null;
	/** The mean CIELAB colour of the trunk below the crown, and its sRGB hex. */
	readonly bark: { readonly lab: readonly number[]; readonly hex: string } | null;
	/** The colours of the background, as sRGB hex: the sky at mid-height and the ground. */
	readonly sky: string;
	readonly ground: string | null;
	/**
	 * Where the picture's light comes from, in degrees: how far the crown's brighter side stands to
	 * the camera's right, and how high the light is above the horizon, read from the crown's own
	 * shading. Null when the plant has no crown to read it from.
	 */
	readonly light: { readonly azimuth: number; readonly rise: number } | null;
}

/** The number of height bands of a width profile. */
export const PROFILE_BANDS = 24;

/** Each row's leftmost and rightmost plant pixel, or -1 for a row with none. */
export function rowSpans(mask: Uint8Array, width: number, height: number): Int32Array {
	const spans = new Int32Array(height * 2).fill(-1);
	for (let y = 0; y < height; y++) {
		let left = -1;
		let right = -1;
		for (let x = 0; x < width; x++)
			if (mask[y * width + x]) {
				if (left < 0) left = x;
				right = x;
			}
		spans[y * 2] = left;
		spans[y * 2 + 1] = right;
	}
	return spans;
}

/**
 * Each row as one run as wide as the plant it holds, centred on the frame: the first and last
 * columns of that run, or -1 for a row with no plant. A row of spread stems then reads as narrow as
 * its stems together, and a row of foliage as wide as its foliage.
 */
export function filledSpans(mask: Uint8Array, width: number, height: number): Int32Array {
	const spans = new Int32Array(height * 2).fill(-1);
	for (let y = 0; y < height; y++) {
		let filled = 0;
		for (let x = 0; x < width; x++) filled += mask[y * width + x] ? 1 : 0;
		if (filled === 0) continue;
		const left = (width - filled) >> 1;
		spans[y * 2] = left;
		spans[y * 2 + 1] = left + filled - 1;
	}
	return spans;
}

/** The box round a mask's plant pixels, or null for an empty mask. */
export function boxOf(mask: Uint8Array, width: number, height: number): Box | null {
	let left = width;
	let top = height;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			if (mask[y * width + x]) {
				if (x < left) left = x;
				if (x > right) right = x;
				if (y < top) top = y;
				bottom = y;
			}
	return right < 0 ? null : { left, top, right, bottom };
}

/** The plant's width in each height band over its height, from the rows' spans. */
export function widthProfile(spans: Int32Array, box: Box, bands = PROFILE_BANDS): number[] {
	const tall = box.bottom - box.top + 1;
	return Array.from({ length: bands }, (_, band) => {
		const from = box.top + Math.floor((band * tall) / bands);
		const to =
			box.top +
			Math.max(Math.floor(((band + 1) * tall) / bands), Math.floor((band * tall) / bands) + 1);
		let widest = 0;
		for (let y = from; y < Math.min(to, box.bottom + 1); y++) {
			const left = spans[y * 2] as number;
			if (left >= 0) widest = Math.max(widest, (spans[y * 2 + 1] as number) - left + 1);
		}
		return widest / tall;
	});
}

/**
 * The range over which a plant's foot starts to read as a mound: a tuft, a rosette or a mound runs
 * nearly as wide at its foot as through its crown, and a tree's foot is a small share of its crown.
 * The share below is the least width of the plant's lowest tenth against its widest row. The range
 * is wide on purpose, so a plant near the mark moves its crown's foot by inches, not by a step.
 */
const MOUND_FROM = 0.7;
const MOUND_TO = 0.95;
/** How much of a mound a plant must be before the bole rule reaches its crown start. */
const MOUND_BOLE_FROM = 0.5;
/** How many trunk widths a row may stand before it belongs to the crown rather than the bole. */
const BOLE_MULTIPLE = 2.5;
/**
 * The share of the plant's widest row at which a trunk stops reading as a stem. A row's outermost
 * span joins a stem to the boughs that sweep beside it and can stand as wide as the crown; above
 * this share the bole rule reads the stem from its own central run.
 */
const CORRUPT_TRUNK_SHARE = 0.5;

/** A value that rises smoothly from 0 at `from` to 1 at `to`, and stays at the ends. */
function smoothstep(from: number, to: number, value: number): number {
	const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
	return t * t * (3 - 2 * t);
}

/**
 * The narrowest median of the lowest bands: a stem's own width, clear of a buttressed foot and a low
 * crown, whose widths lie above it.
 */
function lowestMedian(width: (y: number) => number, box: Box, tall: number): number {
	let trunk = Number.POSITIVE_INFINITY;
	for (const [from, to] of [
		[0, 0.06],
		[0.06, 0.12],
		[0.12, 0.18],
	] as const) {
		const low: number[] = [];
		const first = box.bottom - Math.round(tall * from);
		const last = box.bottom - Math.max(2, Math.round(tall * to));
		for (let y = first; y > last; y--) low.push(width(y));
		low.sort((a, b) => a - b);
		const median = low[low.length >> 1];
		if (median !== undefined) trunk = Math.min(trunk, median);
	}
	return Number.isFinite(trunk) ? trunk : 0;
}

/**
 * Each row's central plant run: the width of the contiguous run nearest the plant's centre column,
 * or 0 for a row with no plant. A row's outermost span joins a stem to the boughs that sweep beside
 * it and reads as wide as the crown, where the central run is the stem the boughs stand apart from.
 */
export function centralRuns(mask: Uint8Array, width: number, box: Box): Int32Array {
	const runs = new Int32Array(box.bottom + 1);
	const centre = (box.left + box.right) / 2;
	for (let y = box.top; y <= box.bottom; y++) {
		let start = -1;
		let nearest = Number.POSITIVE_INFINITY;
		for (let x = 0; x <= width; x++) {
			const on = x < width && mask[y * width + x] !== 0;
			if (on && start < 0) start = x;
			if (!on && start >= 0) {
				const distance = centre < start ? start - centre : centre > x - 1 ? centre - (x - 1) : 0;
				if (distance < nearest) {
					nearest = distance;
					runs[y] = x - start;
				}
				start = -1;
			}
		}
	}
	return runs;
}

/**
 * The row where the crown starts: going up from the plant's base, the first row from which the
 * plant stays wider than its trunk by a clear margin. The trunk's width is the median width of the
 * lowest rows. A plant with no bare stem runs as wide at its foot as at its widest, and its crown
 * starts at its foot; its whole box is its crown, which is what its openness is measured over.
 */
export function crownStartRow(
	spans: Int32Array,
	box: Box,
	central?: Int32Array,
	habit?: PlantHabit,
): number {
	const tall = box.bottom - box.top + 1;
	const width = (y: number) => {
		const left = spans[y * 2] as number;
		return left < 0 ? 0 : (spans[y * 2 + 1] as number) - left + 1;
	};
	// The trunk's width is the narrowest median of the lowest bands: a buttressed foot widens the
	// rows at the ground, and a low crown widens the rows above it, so the stem's own width lies in
	// the band between the two.
	const trunk = lowestMedian(width, box, tall);
	let widest = 0;
	for (let y = box.top; y <= box.bottom; y++) widest = Math.max(widest, width(y));
	// The foot's flare: the widening where the stem meets the ground, or a strip of ground that the
	// mask keeps at the plant's base. It is not the crown, and it can be the plant's widest row, so
	// the limit below is taken from the crown's own widest row above it. A flare is a wide run at the
	// foot with the narrower stem continuing above it; a plant wide from its base has none.
	const crownWidest = ((): number => {
		const band = Math.max(2, Math.round(tall * 0.15));
		const stemRun = Math.max(2, Math.round(tall * 0.02));
		const top = Math.max(box.top, box.bottom - band);
		let y = box.bottom;
		let widestCrown = 0;
		while (y > top && width(y) <= trunk * 1.5) y--;
		if (y > top && width(y) > trunk * 1.5) {
			while (y > top && width(y) > trunk * 1.5) y--;
			let narrow = 0;
			for (let z = y; z > Math.max(box.top, y - stemRun); z--)
				if (width(z) <= trunk * 1.5) narrow++;
			if (narrow < Math.round(stemRun * 0.8)) y = box.bottom;
		} else y = box.bottom;
		for (let z = box.top; z <= y; z++) widestCrown = Math.max(widestCrown, width(z));
		return widestCrown > 0 ? widestCrown : widest;
	})();
	// A plant that runs nearly as wide at its foot as at its widest has no bare stem below its
	// crown: a tuft, a rosette or a mound. Its crown starts at its foot, so its whole box is the
	// crown's and its openness is measured over the plant rather than a slice above the mound. A
	// ground line that reaches both frame edges below the plant is not the plant's foot.
	let frame = 0;
	for (let y = box.top; y <= box.bottom; y++)
		frame = Math.max(frame, (spans[y * 2 + 1] as number) + 1);
	let foot = box.bottom;
	while (
		foot > box.top &&
		(spans[foot * 2] as number) <= 0 &&
		(spans[foot * 2 + 1] as number) >= frame - 1
	)
		foot--;
	const low: number[] = [];
	for (let y = foot; y > foot - Math.max(2, Math.round(tall * 0.1)); y--) low.push(width(y));
	low.sort((a, b) => a - b);
	// How much of a mound the plant is: a foot as wide as the plant's widest row leaves no bare stem,
	// so its crown starts at its foot. The share rises smoothly rather than stepping at a mark, since
	// the crown's box, its openness and every figure read from them would jump as a plant crossed it.
	const footShare = widest > 0 ? (low[low.length >> 1] as number) / widest : 0;
	const mound = smoothstep(MOUND_FROM, MOUND_TO, footShare);
	// A stem's own width plus a clear margin, but never so much of the plant's width that a thick
	// bole reads as foliage: on a low-crowned tree whose trunk is a third of its height across, an
	// uncapped margin swallows the crown and the foot lands wherever the first wide run begins.
	// The limit is taken from the crown's own widest row, not the plant's: a flare at the foot, or a
	// strip of ground the mask keeps at its base, is often the plant's widest row of all, and a limit
	// near the crown's own width leaves the crown's lowest boughs below it as if they were stem.
	const limit = Math.min(Math.max(trunk * 2.5, crownWidest * 0.12), crownWidest * 0.55);
	// The crown's own rows say where it starts: its wide stretch runs from the top down, and the
	// first narrow stretch below it that the stem continues below is its base. A scan from the foot's
	// end cannot be trusted, because a flare or a ground strip is a wide stretch of its own there.
	const found = crownStartFromTop(spans, box, limit);
	const fromMound = Math.round(found + mound * (box.bottom - found));
	// A photograph of a whole plant can read its bole as crown: when the stem is wide the mound rule
	// pulls the start to the foot, and the crown's box then holds the whole plant. The stem below the
	// first row standing wider than a set multiple of the trunk's own width is not crown, so on a
	// plant the mound rule reaches, the start never falls below that row's top. A tuft is wide at its
	// own foot, so its first wide row is its foot and its start is unchanged.
	// The rule reaches two cases: a plant the mound rule pulls to its foot, and any start the finder
	// itself leaves at the foot, where a photograph's bole reads as crown. A close view's crown
	// starts well above its foot, so its start is untouched.
	const footStart = box.bottom - fromMound <= Math.max(1, Math.round(tall * 0.01));
	if (mound <= MOUND_BOLE_FROM && !footStart) return fromMound;
	// A low crown whose boughs sweep beside the stem makes a row's outermost span as wide as the
	// crown, so a trunk read from it stands as wide as the plant and the bole cap never fires. Where
	// that shows, the stem is the row's own central run: scan that, past the frame's bottom sliver
	// and the foot's flare, for the first row above the stem that stands wider than the bole limit.
	const stem =
		central !== undefined && habit !== 'mound' && widest > 0 && trunk > widest * CORRUPT_TRUNK_SHARE
			? central
			: undefined;
	const boleLimit =
		(stem === undefined ? trunk : lowestMedian((y) => stem[y] as number, box, tall)) *
		BOLE_MULTIPLE;
	let bole = foot;
	if (stem === undefined) {
		// The scan starts above the strip of ground the mask keeps at the plant's foot, which is often
		// the widest run of all and is not the bole.
		for (let y = foot; y > box.top; y--) {
			if (width(y) > boleLimit) {
				bole = y;
				break;
			}
		}
	} else {
		const at = (y: number) => stem[y] as number;
		let y = foot;
		while (y > box.top && at(y) <= 2) y--;
		while (y > box.top && at(y) > boleLimit) y--;
		for (; y > box.top; y--)
			if (at(y) > boleLimit) {
				bole = y;
				break;
			}
	}
	return Math.min(fromMound, bole);
}

/**
 * Where the crown starts, found from its own rows: the first narrow stretch below the crown's wide
 * top that the stem continues below. The lower edge of the foliage, whatever the ground below it
 * reads as.
 */
function crownStartFromTop(spans: Int32Array, box: Box, limit: number): number {
	const tall = box.bottom - box.top + 1;
	const width = (y: number) => {
		const left = spans[y * 2] as number;
		return left < 0 ? 0 : (spans[y * 2 + 1] as number) - left + 1;
	};
	const run = Math.max(2, Math.round(tall * 0.03));
	// An airy crown is full of narrow rows of its own, so a narrow stretch alone does not make a
	// crown's foot. Only the stem runs on below the lowest foliage, so a candidate is the foot
	// when the rows beneath it stay narrow.
	const check = Math.max(3, Math.round(tall * 0.12));
	const stemShare = (y: number): number => {
		const to = Math.min(box.bottom, y + check);
		if (to <= y) return 1;
		let narrow = 0;
		for (let k = y + 1; k <= to; k++) if (width(k) <= limit) narrow++;
		return narrow / (to - y);
	};
	let y = box.top;
	while (y <= box.bottom && width(y) <= limit) y++;
	for (; y <= box.bottom; y++) {
		for (let k = 0; k < run && y + k <= box.bottom; k++) {
			if (width(y + k) > limit) continue;
			const foot = Math.max(box.top, y + k - 1);
			if (stemShare(foot) >= 0.7) return foot;
			break;
		}
	}
	return box.bottom;
}

/**
 * The mean CIELAB colour of the pixels that a test picks, or null when it picks none. A weight
 * shares each pixel's influence: a render's matte gives the share of the texel its leaf covers, so
 * a partly covered edge texel, whose colour blends towards the sky, does not count as a whole leaf.
 */
function meanColour(
	lab: Float32Array,
	count: number,
	pick: (at: number) => boolean,
	weight?: (at: number) => number,
): { lab: number[]; hex: string } | null {
	const sum = [0, 0, 0];
	let n = 0;
	for (let at = 0; at < count; at++) {
		if (!pick(at)) continue;
		const share = weight ? weight(at) : 1;
		if (share <= 0) continue;
		for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (lab[at * 3 + c] as number) * share;
		n += share;
	}
	if (n === 0) return null;
	const mean = sum.map((v) => v / n);
	return { lab: mean.map((v) => Number(v.toFixed(2))), hex: hexOf(srgbOf(mean)) };
}

/**
 * Measures a plant from its outline in a picture.
 *
 * A cut piece's crown bottom is its reference picture's own crown share of the plant's height: the
 * same share on both sides bounds the same part of the piece, so a stem outside the picture's
 * subject stays out of the box. A piece with no share takes its whole box. A mound's crown start
 * stays at its foot.
 */
export function measurePlant(
	image: Rgba,
	plant: PlantMask,
	habit?: PlantHabit,
	piece = false,
	subject?: number,
): PlantMeasures {
	const { width, height, mask, coverage, background } = plant;
	const work = image.width === width ? image : resizeToWidth(image, width);
	const lab = labImage(work);
	const horizon = background.horizon;
	const skyAt = surfaceAt(background.sky, 0.5, horizon === null ? 0.5 : horizon / height / 2);
	const groundAt =
		background.ground && horizon !== null
			? surfaceAt(background.ground, 0.5, (horizon / height + 1) / 2)
			: null;
	const base = {
		width,
		height,
		horizon: horizon === null ? null : horizon / height,
		sky: hexOf(srgbOf(skyAt)),
		ground: groundAt ? hexOf(srgbOf(groundAt)) : null,
	};
	const box =
		background.plain || skyMaskable(background) || soilMaskable(background, height)
			? boxOf(mask, width, height)
			: null;
	if (!box)
		return {
			...base,
			box: null,
			clipped: { left: false, top: false, right: false, bottom: false },
			widthProfile: [],
			crownStart: 0,
			crownBox: { width: 0, height: 0 },
			crownRegion: null,
			gapFraction: 0,
			gapByCoverage: null,
			crownBoxGap: 0,
			frameGap: 0,
			solidity: 0,
			foliage: null,
			bark: null,
			light: null,
		};
	const spans = rowSpans(mask, width, height);
	const tall = box.bottom - box.top + 1;
	// A clump's stems spread from its stool, so a row through them spans wide while it holds little
	// plant. Its crown starts where the rows fill with foliage, so each row counts by the plant it
	// holds, not by the span between its outermost stems.
	const start = piece
		? subject !== undefined
			? Math.min(box.bottom, box.top + Math.max(1, Math.round(subject * tall)) - 1)
			: box.bottom
		: habit === 'clump'
			? crownStartRow(filledSpans(mask, width, height), box)
			: crownStartRow(spans, box, centralRuns(mask, width, box), habit);
	// The crown's outline: in each crown row, everything between the row's outermost plant pixels.
	let hull = 0;
	let gaps = 0;
	let clear = 0;
	let crownWidth = 0;
	let crownLeft = width;
	let crownRight = -1;
	const inCrown = new Uint8Array(width * height);
	for (let y = box.top; y <= start; y++) {
		const left = spans[y * 2] as number;
		if (left < 0) continue;
		const right = spans[y * 2 + 1] as number;
		crownWidth = Math.max(crownWidth, right - left + 1);
		crownLeft = Math.min(crownLeft, left);
		crownRight = Math.max(crownRight, right);
		for (let x = left; x <= right; x++) {
			hull++;
			if (!mask[y * width + x]) {
				// A texel is sky or plant, on a render as on a photograph, so both sides of a pair
				// count their sky one way. A render's matte also carries how much of the texel a
				// leaf covers, which gives the second reading.
				const at = y * width + x;
				gaps++;
				if (coverage) clear += 1 - (coverage[at] as number) / 255;
			} else inCrown[y * width + x] = 1;
		}
	}
	const sky = (at: number): number =>
		coverage ? 1 - (coverage[at] as number) / 255 : mask[at] ? 0 : 1;
	// A texel's own coverage shares its colour: an edge texel whose colour blends towards the sky
	// barely counts, where a photograph has no coverage and every texel counts whole.
	const leafShare = coverage ? (at: number) => (coverage[at] as number) / 255 : undefined;
	let crownBoxSky = 0;
	const crownBoxHeight = start - box.top + 1;
	if (crownRight >= crownLeft)
		for (let y = box.top; y <= start; y++)
			for (let x = crownLeft; x <= crownRight; x++) crownBoxSky += sky(y * width + x);
	const crownBoxArea = crownRight >= crownLeft ? (crownRight - crownLeft + 1) * crownBoxHeight : 0;
	let frameSky = 0;
	for (let at = 0; at < mask.length; at++) frameSky += sky(at);
	let covered = 0;
	for (let y = box.top; y <= box.bottom; y++)
		for (let x = box.left; x <= box.right; x++) covered += mask[y * width + x] as number;
	return {
		...base,
		box,
		clipped: {
			left: box.left <= 0,
			top: box.top <= 0,
			right: box.right >= width - 1,
			bottom: box.bottom >= height - 1,
		},
		widthProfile: widthProfile(spans, box).map((v) => Number(v.toFixed(4))),
		crownStart: Number(((box.bottom - start) / tall).toFixed(4)),
		crownBox: { width: crownWidth, height: start - box.top + 1 },
		crownRegion:
			crownRight >= crownLeft
				? { left: crownLeft, top: box.top, right: crownRight, bottom: start }
				: null,
		gapFraction: hull > 0 ? Number((gaps / hull).toFixed(4)) : 0,
		gapByCoverage: coverage ? (hull > 0 ? Number((clear / hull).toFixed(4)) : 0) : null,
		crownBoxGap: crownBoxArea > 0 ? Number((crownBoxSky / crownBoxArea).toFixed(4)) : 0,
		frameGap: Number((frameSky / (width * height)).toFixed(4)),
		solidity: Number((covered / ((box.right - box.left + 1) * tall)).toFixed(4)),
		foliage: meanColour(lab, width * height, (at) => inCrown[at] === 1, leafShare),
		bark:
			start < box.bottom
				? meanColour(lab, width * height, (at) => {
						const y = Math.floor(at / width);
						return y > start && mask[at] === 1;
					})
				: null,
		light: crownLight(lab, inCrown, width, box, start),
	};
}

/** The share of a crown's plant pixels that foliage covers, and why a picture gives none. */
export interface CrownFoliage {
	/** Foliage's share of the plant's pixels in the crown's box, or null where colour cannot part them. */
	readonly share: number | null;
	/** The plant pixels of the crown's box that the share counts. */
	readonly pixels: number;
	/** Why the share is null. */
	readonly why?: string;
}

/** The fewest plant pixels a crown's box needs before its colours can be fitted. */
const CROWN_FOLIAGE_PIXELS = 40;
/** The least CIELAB a* between the two clusters that parts foliage from bark. */
const FOLIAGE_GAP = 6;

/**
 * The crown's foliage share in a picture: of the plant pixels in the crown's box, the share that
 * belongs to the greener of two colour clusters fitted to the box. The clusters are fitted in
 * CIELAB chroma, since light and shade move a leaf's lightness but keep its hue. A picture whose
 * greener cluster is not leaf green gives no share: a bare tree's browns, grey or blue foliage, or
 * a crown that blends into a brown ground cannot be parted by colour, and the figure says so
 * rather than guesses.
 */
export function crownFoliageOf(image: Rgba, plant: PlantMask, region: CrownRegion): CrownFoliage {
	const work = image.width === plant.width ? image : resizeToWidth(image, plant.width);
	const lab = labImage(work);
	const width = plant.width;
	const height = plant.height;
	const left = Math.max(0, Math.min(width - 1, region.left));
	const right = Math.max(0, Math.min(width - 1, region.right));
	const top = Math.max(0, Math.min(height - 1, region.top));
	const bottom = Math.max(0, Math.min(height - 1, region.bottom));
	let count = 0;
	for (let y = top; y <= bottom; y++)
		for (let x = left; x <= right; x++) if (plant.mask[y * width + x]) count++;
	if (count === 0) return { share: null, pixels: 0, why: "the crown's box covers no plant" };
	if (count < CROWN_FOLIAGE_PIXELS)
		return {
			share: null,
			pixels: count,
			why: `the crown's box holds only ${count} plant pixels, too few to fit its colours`,
		};
	const chroma = new Float32Array(count * 2);
	let at = 0;
	let greenest = 0;
	let brownest = 0;
	let least = Number.POSITIVE_INFINITY;
	let most = Number.NEGATIVE_INFINITY;
	for (let y = top; y <= bottom; y++)
		for (let x = left; x <= right; x++) {
			const pixel = y * width + x;
			if (!plant.mask[pixel]) continue;
			const a = lab[pixel * 3 + 1] as number;
			const b = lab[pixel * 3 + 2] as number;
			chroma[at * 2] = a;
			chroma[at * 2 + 1] = b;
			if (a < least) {
				least = a;
				greenest = at;
			}
			if (a > most) {
				most = a;
				brownest = at;
			}
			at++;
		}
	// Two-means over the chroma, started at the greenest and brownest pixels so the fit finds the
	// two colours a crown shows rather than an even cut through one colour's spread.
	let greenA = chroma[greenest * 2] as number;
	let greenB = chroma[greenest * 2 + 1] as number;
	let brownA = chroma[brownest * 2] as number;
	let brownB = chroma[brownest * 2 + 1] as number;
	const side = new Uint8Array(count);
	for (let step = 0; step < 24; step++) {
		let greenSumA = 0;
		let greenSumB = 0;
		let greenCount = 0;
		let brownSumA = 0;
		let brownSumB = 0;
		let brownCount = 0;
		for (let i = 0; i < count; i++) {
			const a = chroma[i * 2] as number;
			const b = chroma[i * 2 + 1] as number;
			const green = (a - greenA) ** 2 + (b - greenB) ** 2;
			const brown = (a - brownA) ** 2 + (b - brownB) ** 2;
			if (green <= brown) {
				side[i] = 0;
				greenSumA += a;
				greenSumB += b;
				greenCount++;
			} else {
				side[i] = 1;
				brownSumA += a;
				brownSumB += b;
				brownCount++;
			}
		}
		const nextGreenA = greenCount > 0 ? greenSumA / greenCount : greenA;
		const nextGreenB = greenCount > 0 ? greenSumB / greenCount : greenB;
		const nextBrownA = brownCount > 0 ? brownSumA / brownCount : brownA;
		const nextBrownB = brownCount > 0 ? brownSumB / brownCount : brownB;
		const settled =
			Math.abs(nextGreenA - greenA) < 1e-6 &&
			Math.abs(nextGreenB - greenB) < 1e-6 &&
			Math.abs(nextBrownA - brownA) < 1e-6 &&
			Math.abs(nextBrownB - brownB) < 1e-6;
		greenA = nextGreenA;
		greenB = nextGreenB;
		brownA = nextBrownA;
		brownB = nextBrownB;
		if (settled) break;
	}
	let greenPixels = 0;
	for (let i = 0; i < count; i++) if (side[i] === 0) greenPixels++;
	let brownPixels = count - greenPixels;
	// Name the clusters by their colour, whatever order the fit settles them in.
	if (greenA > brownA) {
		[greenA, brownA] = [brownA, greenA];
		[greenPixels, brownPixels] = [brownPixels, greenPixels];
	}
	// With one cluster, every plant pixel of the crown is one colour: all green reads as all
	// foliage, and any other colour gives no share.
	if (brownPixels === 0 || greenPixels === 0) {
		let sumA = 0;
		for (let i = 0; i < count; i++) sumA += chroma[i * 2] as number;
		const meanA = sumA / count;
		return meanA < LEAF_GREEN
			? { share: 1, pixels: count }
			: {
					share: null,
					pixels: count,
					why: `the crown's colours do not part its foliage from its wood: its plant pixels read a* ${meanA.toFixed(1)}, not leaf green`,
				};
	}
	if (greenA >= LEAF_GREEN)
		return {
			share: null,
			pixels: count,
			why: `the crown's colours do not part its foliage from its wood: its greener cluster reads a* ${greenA.toFixed(1)}, not leaf green`,
		};
	if (brownA < LEAF_GREEN) return { share: 1, pixels: count };
	if (brownA - greenA < FOLIAGE_GAP)
		return {
			share: null,
			pixels: count,
			why: `the crown's colours do not part its foliage from its wood: its two clusters stand ${(brownA - greenA).toFixed(1)} apart in a*`,
		};
	return { share: Number((greenPixels / count).toFixed(4)), pixels: count };
}

/** The median of a list of numbers, or undefined for an empty list. */
export function median(values: readonly number[]): number | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2
		? sorted[mid]
		: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * The column of the plant's trunk at its base, or the box's middle when the base is cut off.
 *
 * A low limb that sweeps out near the foot merges with the trunk in a row's outer extent, so each
 * row of the base band gives the run nearest the plant's middle column, and the median of those
 * centres stands for the trunk. The lowest few rows of a broad crown are then outvoted.
 */
export function anchorColumn(mask: Uint8Array, width: number, height: number, box: Box): number {
	if (box.bottom >= height - 1) return (box.left + box.right) / 2;
	const middle = (box.left + box.right) / 2;
	const band = Math.max(2, Math.round((box.bottom - box.top + 1) * 0.15));
	const centres: number[] = [];
	for (let y = box.bottom; y > box.bottom - band; y--) {
		let best: number | null = null;
		let runStart = -1;
		for (let x = 0; x <= width; x++) {
			const on = x < width && mask[y * width + x] === 1;
			if (on && runStart < 0) runStart = x;
			if (!on && runStart >= 0) {
				const centre = (runStart + x - 1) / 2;
				if (best === null || Math.abs(centre - middle) < Math.abs(best - middle)) best = centre;
				runStart = -1;
			}
		}
		if (best !== null) centres.push(best);
	}
	return median(centres) ?? (box.left + box.right) / 2;
}

/** The crown's covered area either side of the trunk's column, as shares of the whole crown. */
export interface CrownBalance {
	/** The share of the crown's covered pixels left of the trunk's column. */
	readonly left: number;
	/** The share right of it. */
	readonly right: number;
	/** The column, in work pixels, that the crown is split at. */
	readonly column: number;
}

/**
 * The crown's covered area either side of the trunk's column, as shares of the whole crown. The
 * column is the trunk's at its base, so a crown that gathers its mass on one side reads unevenly
 * even where its outline matches its reference's. A crown whose column falls outside its box splits
 * at the box's edge, which is the plant's own answer.
 */
export function crownBalanceOf(plant: PlantMask, region: CrownRegion): CrownBalance | null {
	const box = boxOf(plant.mask, plant.width, plant.height);
	if (!box) return null;
	const column = anchorColumn(plant.mask, plant.width, plant.height, box);
	let left = 0;
	let right = 0;
	for (let y = region.top; y <= region.bottom; y++)
		for (let x = region.left; x <= region.right; x++) {
			if (!plant.mask[y * plant.width + x]) continue;
			if (x < column) left++;
			else right++;
		}
	const covered = left + right;
	if (covered === 0) return null;
	return {
		left: Number((left / covered).toFixed(4)),
		right: Number((right / covered).toFixed(4)),
		column: Number(column.toFixed(2)),
	};
}

/**
 * The bands the crown's balance is read in, top first. Six is the review's own granularity for a
 * crown's vertical structure: a sixth of the crown's height is a few dozen rows at the work width,
 * which holds thousands of covered pixels, so a band's split is stable. Fewer bands average a
 * hollow flank with the full rows above and below it; more let one leaf clump set a band.
 */
export const BALANCE_BANDS = 6;
/** The fewest covered pixels a band needs on each picture before its split is read. */
const BAND_LEAST = 16;

/** The crown's balance read in horizontal bands, top first. */
export interface CrownBands {
	/** Each band's left share of its covered area, top first; null for a band too thin to read. */
	readonly left: readonly (number | null)[];
	/** The column, in work pixels, that each band is split at. */
	readonly column: number;
}

/**
 * The crown's covered area in horizontal bands, each band split at the trunk's column: the left
 * side's share of the band's covered area, top first. A hollow flank shows as a band whose split
 * stands far from its reference's, even where the whole crown's two sides balance.
 */
export function crownBandsOf(
	plant: PlantMask,
	region: CrownRegion,
	bands = BALANCE_BANDS,
): CrownBands | null {
	const box = boxOf(plant.mask, plant.width, plant.height);
	if (!box) return null;
	const column = anchorColumn(plant.mask, plant.width, plant.height, box);
	const height = region.bottom - region.top + 1;
	const left = new Array<number>(bands).fill(0);
	const total = new Array<number>(bands).fill(0);
	for (let y = region.top; y <= region.bottom; y++) {
		const band = Math.min(bands - 1, Math.floor(((y - region.top) * bands) / height));
		for (let x = region.left; x <= region.right; x++) {
			if (!plant.mask[y * plant.width + x]) continue;
			total[band] = (total[band] as number) + 1;
			if (x < column) left[band] = (left[band] as number) + 1;
		}
	}
	if (total.every((count) => count === 0)) return null;
	return {
		left: left.map((count, band) =>
			(total[band] as number) < BAND_LEAST
				? null
				: Number((count / (total[band] as number)).toFixed(4)),
		),
		column: Number(column.toFixed(2)),
	};
}

/**
 * Where a picture's light comes from, read off the crown's own shading. The brighter half of the
 * crown stands towards the sun, and a crown whose top is much brighter than its foot is lit from
 * higher. The figure is coarse by nature: one flat picture cannot say more than which side is lit.
 */
function crownLight(
	lab: Float32Array,
	crown: Uint8Array,
	width: number,
	box: Box,
	start: number,
): { readonly azimuth: number; readonly rise: number } | null {
	const column = (box.left + box.right) / 2;
	let left = 0;
	let leftCount = 0;
	let right = 0;
	let rightCount = 0;
	let top = 0;
	let topCount = 0;
	let foot = 0;
	let footCount = 0;
	const band = Math.max(1, Math.round((start - box.top + 1) / 3));
	for (let y = box.top; y <= start; y++)
		for (let x = box.left; x <= box.right; x++) {
			const at = y * width + x;
			if (crown[at] !== 1) continue;
			const shade = lab[at * 3] as number;
			if (x < column) {
				left += shade;
				leftCount++;
			} else {
				right += shade;
				rightCount++;
			}
			if (y < box.top + band) {
				top += shade;
				topCount++;
			} else if (y > start - band) {
				foot += shade;
				footCount++;
			}
		}
	if (leftCount === 0 || rightCount === 0) return null;
	// How much brighter one side is, against the difference a full turn of the light would give.
	const side = right / rightCount - left / leftCount;
	const azimuth = Number((60 * Math.max(-1, Math.min(1, side / 18))).toFixed(1));
	const high = topCount > 0 && footCount > 0 ? top / topCount - foot / footCount : 0;
	// A crown lit from overhead shows a bright top over a dark foot; one lit from the side shows less.
	const rise = Number((35 + 20 * Math.max(-1, Math.min(1, high / 18))).toFixed(1));
	return { azimuth, rise };
}

/** A picture of a mask beside its picture: the picture with the background dimmed to grey. */
export function maskPreview(image: Rgba, plant: PlantMask): Rgba {
	const work = image.width === plant.width ? image : resizeToWidth(image, plant.width);
	const out = blank(work.width, work.height, [0, 0, 0]);
	for (let at = 0; at < plant.mask.length; at++) {
		const keep = plant.mask[at] === 1;
		for (let c = 0; c < 3; c++) {
			const v = work.data[at * 4 + c] as number;
			out.data[at * 4 + c] = keep ? v : Math.round(160 + (v - 160) * 0.15);
		}
	}
	if (plant.background.horizon !== null)
		for (let x = 0; x < out.width; x++) {
			const at = (plant.background.horizon * out.width + x) * 4;
			out.data[at] = 255;
			out.data[at + 1] = 0;
			out.data[at + 2] = 0;
		}
	return out;
}
