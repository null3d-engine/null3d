// The species record and every part of it: what one species is, as plain data. A record names its
// growth model and that model's numbers, the outline the plant fills, its shoots and leaves, its
// bark, its extras, its seasons, its wind and its detail levels with its own budget. Nothing here
// runs: the growers, the leaf builders and the meshers read these numbers.

import type { ShootPrototype } from '../asset';
import type { EcoRule } from '../ecology/ecology';
import type { FrameSpec } from '../grow/frame';
import type { PieceRule } from '../leaf/piece';
import type { MacroSkeleton } from './graph';
import type { SpeciesTextureFiles } from './textures';
import type { Curve, Detail, Rgb, Season, Spread, Vec2, Vec3 } from './types';

/**
 * One species: the folder of its own under `species/`, grown by one of the growth models.
 *
 * @category api/vegetation
 */
export interface Species {
	/** The folder name under `species/`, kebab-case: the registry key and the texture folder. */
	readonly id: string;
	/** The common name, such as "Pedunculate oak". */
	readonly name: string;
	/** The Latin name, such as "Quercus robur". */
	readonly latin: string;
	/** The catalogue's growth form, in words. The species page and the distinctness check read it. */
	readonly form: string;
	/**
	 * The species' other forms by name, such as `young` or `woodland`: the same plant grown young or
	 * in another habit, each given as the changes it makes to this record. A page asks for one by
	 * name when it prepares the species. Without a form asked for, the plant grows from this record
	 * as it stands, and a record with no forms grows as one without the field.
	 */
	readonly forms?: Readonly<Record<string, SpeciesForm>>;
	/** The plant's size. */
	readonly size: PlantSize;
	/** How the large structure grows: the model and its numbers. */
	readonly growth: Growth;
	/**
	 * The outline the plant fills. Required for 'self-organizing' and 'scaffold'; a cap for the other
	 * models.
	 */
	readonly envelope?: Envelope;
	/**
	 * The branch pieces that the plant's sockets carry, each a measured rule. A species that grows
	 * by a directed model builds its kit from these, and its shoot classes then serve only as the
	 * source of its twig, bud and leaf figures. Another model ignores them.
	 */
	readonly pieces?: readonly PieceRule[];
	/** The shoot prototypes that carry the finest orders, buds and leaves. */
	readonly shoots?: ShootSpec;
	/** What the leaves are. */
	readonly foliage: Foliage;
	/**
	 * The share of the open sky, 0 to 1, added to the leaf and card faces' ambient light, where a
	 * crown's leaves stand in less skylight than its photographs show. The value is the extinction
	 * that the added sky term uses, its own per species: the far-card shading's share, applied to the
	 * leaf faces. Absent or 0, the faces draw as before.
	 */
	readonly skyToLeaf?: number;
	/** The bark zones and how the wood takes them. */
	readonly bark?: BarkSpec;
	/** Root flare, buttresses, surface roots and flutes at the stem base. */
	readonly base?: BaseSpec;
	/** Cones, fruit, flowers, catkins, thorns and spines on bud sites. */
	readonly extras?: readonly ExtraSpec[];
	/** The seasons the plant shows. */
	readonly seasons: SeasonSpec;
	/** How the plant moves in the wind. */
	readonly wind: WindSpec;
	/** The detail levels and this species' own budget. */
	readonly lod: LodSpec;
	/** 'own' reads the species' own texture folder; `{ from }` reads another species' folder. */
	readonly textures: 'own' | { readonly from: string };
	/** Variants grown per species, 1 to 8. A preset may grow fewer. */
	readonly variants: number;
	/** A whole number mixed into every hash, so two species never share random choices. */
	readonly seedSalt: number;
	/** Why this plant is lopsided by nature, when it is: the all-round check's exception. */
	readonly lopsided?: string;
	/** The crown-box band at eight angles: the form's default, or the reference's own spread. */
	readonly roundBand?: number;
	/** Which pieces a close review cuts from the plant. */
	readonly cuttings?: CuttingHints;
	/** Where the scatter places this species: its layer, spacing and tolerances. */
	readonly ecology?: SpeciesEcology;
	/**
	 * What the sparsest form of this species keeps: the least share of its foliage, and which limbs
	 * count as great limbs and so stay whole. A species with no floors takes the add-on's own.
	 */
	readonly sparse?: SparseFloors;
}

/**
 * The floors of a species' sparseness: what its sparsest form keeps, so the plant still reads as
 * its species.
 *
 * @category api/vegetation
 */
export interface SparseFloors {
	/**
	 * The share of the plant's foliage the sparsest form keeps, from 0 to 1: its shoots, or its
	 * leaves where the plant carries no shoots. The shoots are kept whole, at the size they grew.
	 */
	readonly foliage: number;
	/**
	 * The least radius that makes a limb a great limb, as a share of the thickest limb that leaves
	 * the same stem, above 0 and up to 1. A great limb stays whole at every sparseness. Half the
	 * thickest limb's radius when not given.
	 */
	readonly limbs?: number;
}

/**
 * A species' scatter rule without what the record already gives: its id, its variants, and its
 * radius, which defaults to its crown's. `speciesRule` makes the scatter's rule from it.
 *
 * @category api/vegetation
 */
export type SpeciesEcology = Omit<EcoRule, 'species' | 'variants' | 'radius'> & {
	/** The radius the plant keeps to itself, in metres; its crown's by default. */
	readonly radius?: number;
};

/**
 * The fields of a species record that one of its other forms may change: the size, the growth and
 * the outline, the shoots and the leaves, the bark and the stem base, the extras, the wind, the
 * all-round band with its exception, and the pieces a close review cuts. The other fields stay the
 * species' own, so a form's plants keep the species' names, seasons, detail levels and budget,
 * textures, variants, seeds and scatter rule.
 *
 * @category api/vegetation
 */
export type FormField =
	| 'size'
	| 'growth'
	| 'envelope'
	| 'shoots'
	| 'foliage'
	| 'bark'
	| 'base'
	| 'extras'
	| 'wind'
	| 'lod'
	| 'roundBand'
	| 'lopsided'
	| 'cuttings';

/**
 * Another form of a species, such as the plant grown young or grown in a wood: the form in words, and
 * the changes it makes to the species' record. A form names only what differs from the record. Its
 * fields merge into the record's by name, an object's fields into the record's object; a number, a
 * word, a curve or a list replaces the record's whole value; and null drops one of the record's
 * optional fields, as a young plant drops the stem's division into great limbs. A form keeps the
 * species' growth model and its kind of foliage, and the record check checks each form's record as
 * it checks the species' own.
 *
 * @category api/vegetation
 */
export type SpeciesForm = {
	/** The form in words, as the record's own `form` gives the species' growth form. */
	readonly form: string;
} & RecordChanges<Pick<Species, FormField>>;

/**
 * Changes to a part of a record: every field optional, an object's own fields changed in turn, and
 * null in place of an optional field to drop it.
 *
 * @category api/vegetation
 */
export type RecordChanges<T> = {
	readonly [K in keyof T]?: FieldChange<T[K]> | (undefined extends T[K] ? null : never);
};

/**
 * A change to one field of a record: a list or a value given whole, or changes to an object's own
 * fields. A field that may hold one of several kinds of object takes changes to any of them.
 *
 * @category api/vegetation
 */
export type FieldChange<T> = T extends readonly unknown[]
	? T
	: T extends object
		? RecordChanges<T>
		: T;

/**
 * The size of a mature plant.
 *
 * @category api/vegetation
 */
export interface PlantSize {
	/** Height of a mature plant in metres, over copies. */
	readonly height: Spread;
	/** Stem diameter at 1.3 m, in metres, at the mean height. The pipe radii scale to it. */
	readonly dbh?: number;
	/** Crown width over height, which the checks hold against the envelope. */
	readonly aspect: number;
}

/**
 * How the large structure of a plant grows: one model of several, each with its own numbers.
 *
 * @category api/vegetation
 */
export type Growth =
	| SelfOrganizing
	| Scaffold
	| Framed
	| Architectural
	| Conifer
	| CrownRosette
	| Culm
	| Rosette
	| FrondColony
	| Tuft
	| Column;

/**
 * The name of a growth model.
 *
 * @category api/vegetation
 */
export type GrowthModel = Growth['model'];

/**
 * Buds that compete for light in a shadow grid, inside the envelope: every broadleaf, pine, yew,
 * juniper, shrub and hedge.
 *
 * @category api/vegetation
 */
export interface SelfOrganizing {
	/** The model's name. */
	readonly model: 'self-organizing';
	/** Growth cycles. */
	readonly years: number;
	/** Botanical orders grown per plant, 2 to 4. Finer orders come from the shoot prototypes. */
	readonly macroOrders: number;
	/**
	 * The share of the plant's height below which its envelope holds no room, from 0 to 0.5: the
	 * envelope is cut flat there, so the crown's underside stands higher than the fitted outline's
	 * lowest row without the fit being edited by hand. Absent, the envelope starts at its own lowest
	 * height.
	 */
	readonly floor?: number;
	/**
	 * How readily a lateral bud puts out a branch, as a multiplier on its chance: 1 as the light,
	 * the species' angles and the apical dominance give it, above 1 a denser branching, below 1 a
	 * sparser one. This is the wood's density, which with the shoots' own count makes a crown.
	 */
	readonly branching?: number;
	/**
	 * How readily a lateral bud puts out a branch at each order, as a multiplier on `branching`: t is
	 * the axis's order over the macro orders, below 1 keeps fewer side axes and 0 keeps its buds as
	 * shoots. Absent, every order takes `branching` alone.
	 */
	readonly branchingByOrder?: Curve;
	/**
	 * Metres of clear air a shoot keeps from another axis's wood, so two limbs do not pass through
	 * one another as a real tree's do not. 0 by default, which lets shoots meet as they may. Without
	 * `turning`, a shoot that would come nearer stops there.
	 */
	readonly clearance?: number;
	/**
	 * Degrees a shoot may turn aside in one internode to keep its clearance from another axis's
	 * wood: it tries headings at rising angles either side of the one it chose, and takes the first
	 * that is clear and inside the envelope, the side it turned to before first, so a shoot passing
	 * an obstacle curves round it rather than zigzagging. It stops only where no heading within the
	 * angle is clear. 0 or absent, a shoot that would come within the clearance stops there.
	 */
	readonly turning?: number;
	/**
	 * The least share of the trunk's radius that another axis's wood must have to keep clear of a
	 * shoot, from 0 to 1. Each order's share is its girth beside the trunk's. 0 or absent, wood of
	 * every order keeps the clearance, so thin twigs turn each other and move the crown's layout.
	 * At 0.5 only the trunk and the great limbs keep it: branches and twigs keep their layout, and
	 * a great limb does not turn for a twig.
	 */
	readonly clearanceThickness?: number;
	/** Metres of one macro internode in year one, and its shrink per year (0 to 1). */
	readonly internode: { readonly length: number; readonly ageFactor: number };
	/** One stem, or a stool of several that share one light grid. */
	readonly stems: StemSpec;
	/** How lateral buds stand and leave, and how often they die. */
	readonly buds: {
		/** How lateral buds stand on a macro node. */
		readonly arrangement: Phyllotaxis;
		/** Degrees between a lateral shoot and its parent, by order (t = order / macroOrders). */
		readonly angle: Curve;
		/** Degrees the lateral angle varies by. */
		readonly angleSpread: number;
		/** Chance per cycle that a bud dies. */
		readonly extinction: readonly [apical: number, lateral: number];
		/**
		 * The macro orders whose lateral buds grow side axes, from 1 to the macro orders: a lateral
		 * bud on an axis of this order or finer stays a bud, which carries the shoots, so a young
		 * tree's limbs run out unbranched from its stem with 1. Absent, every order grows side axes.
		 */
		readonly sideOrders?: number;
		/**
		 * The share of a great limb's lateral buds that stay buds rather than growing into side
		 * axes, so the limb's own length carries shoots instead of running bare between its
		 * branches. The limbs are the stem's first-order axes. Absent, none stay.
		 */
		readonly limbBuds?: number;
	};
	/** How strongly the leader leads. */
	readonly apical: {
		/** Borchert-Honda lambda by age (t = year / years): over 0.5 excurrent, under 0.5 decurrent. */
		readonly control: Curve;
		/** Apical dominance factors: base, distance and age. */
		readonly dominance: readonly [base: number, distance: number, age: number];
		/** Degrees the leader wanders from its bud's direction. */
		readonly wander: number;
	};
	/**
	 * Where the leader divides into its great limbs, as a share of the plant's height: the stem
	 * stops there and its tip carries the given number of limbs, the first running on up the stem's
	 * old line and the rest spread wide round it. Absent, the leader runs on to the top.
	 */
	readonly divide?: {
		/** The height the stem reaches before it divides, as a share of the plant's height. */
		readonly at: number;
		/** The limbs the division makes, 2 to 6. */
		readonly count: number;
		/** Degrees from the stem's line at which the wide limbs leave. */
		readonly angle: number;
		/** Degrees from the stem's line at which the first limb runs on. */
		readonly lean: number;
		/**
		 * The most degrees the bole leans, once it runs straight from its foot to the division, from 0
		 * (upright) to 90. After growth each of the stem's nodes below the division moves onto a line
		 * from the foot, carrying its side branches, so the bole loses the crook that kinks every shoot
		 * in the crown. The line runs to where the division grew when that leans no more than this;
		 * otherwise it leans this far, and the division and the crown it carries move over with it,
		 * unchanged in shape. Absent, the bole kinks above the envelope's base as the crown's shoots
		 * do.
		 */
		readonly plumb?: number;
	};
	/** How light drives the buds, and the shadow grid. */
	readonly light: {
		/** Exponent on light for apical flushing. */
		readonly apical: number;
		/** Exponent on light for lateral flushing. */
		readonly lateral: number;
		/** Shadow pyramid: depth in cells, and a and b in a shadow of a times b to the minus depth. */
		readonly shadow: readonly [depth: number, a: number, b: number];
		/** Cells across the grid's widest side; at most 96. */
		readonly cells: number;
		/**
		 * Whether a bud that the envelope stopped at the crown's surface takes its share of the
		 * last season's resource by its site's light: its own cell, outside the envelope, holds no
		 * light, but the outermost shoots of a crown see the most sky. Its shoot then draws the class
		 * its share gives. Absent or false, such a bud takes no share and draws the weakest class.
		 */
		readonly surface?: boolean;
		/**
		 * A bias of a bud's light by the room the envelope leaves at its azimuth, so a crown whose
		 * envelope is wider on one side carries more mass there. At 0 or absent the shadow grid's
		 * light stands. Above 0 the light is multiplied by the room's share of the mean room at the
		 * bud's height, raised to this power: the wide side reads above 1, the narrow below it, and
		 * the height's own profile is held.
		 */
		readonly roomBias?: number;
	};
	/** How shoots bend toward light and against gravity. */
	readonly tropism: {
		/** Bend toward light, by order (t = order / macroOrders). */
		readonly photo: Curve;
		/** Bend against gravity, by order. Below 0 the shoot hangs (weeping whips). */
		readonly gravi: Curve;
	};
	/** How shaded branches are shed. */
	readonly shedding: {
		/** Light per internode under which a branch is shed. */
		readonly threshold: number;
		/** No side branch below this share of the height: the clean bole. */
		readonly cleanBole: number;
		/** Share of shed branches that stay as dead stubs. */
		readonly stubs: number;
		/**
		 * Under the crown, as a share of the envelope's base height from 0 to 1, the base measured
		 * where `floor` cuts the envelope: a bud whose node stood lower when it grew reads no sky at
		 * the end of growth, so it dies and the bare wood it leaves dies back as every bare end does.
		 * The line reads each node's height before the wood bends, so a bend that later lifts a node
		 * does not save its bud. Wood that carries a live shoot beyond it stays. Absent, a bud outside
		 * the envelope reads full sky wherever it stands, as at the crown's top and sides.
		 */
		readonly underCrown?: number;
	};
	/**
	 * Sag under the subtree's load, then the tip's upturn (reaction wood). The strength is from 0 (no
	 * sag) and divides by the wood's stiffness, which grows with the fourth power of its radius. The
	 * upturn is the share of its sag an axis's tip turns back up, from 0 to 1.
	 */
	readonly bending: {
		readonly strength: number;
		readonly upturn: number;
		/**
		 * The stem's diameter at 1.3 m, in metres, that the bend weighs the wood at: each radius is
		 * fitted to this girth for the bend alone, so `size.dbh` changes the drawn wood and not the
		 * sag, and the strength keeps its meaning whatever diameter the record draws. Above 0.
		 * Absent, the bend weighs the wood as drawn, and a thinner stem bends more at the same
		 * strength.
		 */
		readonly girth?: number;
	};
	/**
	 * The fork rule: a child's widest angle to its parent shrinks as its share of the parent's wood
	 * grows, from 80 degrees for the thinnest through 65 at a fifth to 15 once it leads its fork. A
	 * side shoot's first internode leaves along its bud, and a small branch whose share grows past
	 * what its angle allows turns toward its parent's line by a few degrees a year, as reaction wood
	 * rights it. Absent or false, shoots keep the angle they grew at.
	 */
	readonly forkRule?: boolean;
	/**
	 * Kinked growth: the wander kinks each internode about the shoot's heading, which takes the
	 * tropisms and only half the wander, so a shoot zigzags, angled at every joint, along a line that
	 * drifts slowly; a stem kinks by half as much. Absent or false, the wander turns the heading
	 * itself, and a long shoot drifts as a random walk.
	 */
	readonly kinks?: boolean;
	/**
	 * The most a step may turn from the axis's last direction, in degrees. Small, the wood bends in
	 * gentle steps that follow its line instead of kinking at odd joints. Absent, the wander turns
	 * the heading without a limit.
	 */
	readonly maxTurn?: number;
	/**
	 * How strongly a first-order limb holds the azimuth its fork gave it, 0 to 1: each step pulls its
	 * sideways direction back toward that azimuth by this share, so the great limbs stay apart round
	 * the stem while the light steers their branches above. Absent, the light steers them freely.
	 */
	readonly limbAzimuth?: number;
	/**
	 * Metres along a parent axis between two neighbouring laterals it grows. A lateral whose node
	 * stands closer than this to the last one accepted keeps its bud, so the branches leave the wood
	 * at separate points rather than as a crowd within one internode. Absent, the chance alone parts
	 * them.
	 */
	readonly lateralSpacing?: number;
	/**
	 * The leader's relay: an axis whose leader bud dies hands the lead to the lateral bud at its tip,
	 * turned in toward the axis's line, and a stem's leader below the crown is spared chance loss, so
	 * no axis ends in a stump. On when absent; false leaves an axis whose leader dies to stop there,
	 * and a young plant whose stem stops can die.
	 */
	readonly relay?: boolean;
	/** Pipe model: a parent's diameter to the exponent is the sum of its children's, and a terminal twig's radius in metres. */
	readonly pipe: {
		readonly exponent: number;
		readonly tipRadius: number;
		/**
		 * The least share of its girth that a stem keeps from one node to the next, from 0.5 to 1. A
		 * leader that carries the crown to its top, as a young tree's or a woodland tree's does, tapers
		 * slowly: at 0.7 or more no limb outgrows it, so the stem runs on to its top rather than
		 * dividing into its thickest limb. Where it keeps more than its pipes give, the stem above a
		 * limb stands thicker than the wood it carries, and it bends a little less under its load.
		 * Absent, a stem keeps half its girth, as every other axis does.
		 */
		readonly leader?: number;
	};
	/** A bottle, a twist or a gnarl in the stem. */
	readonly trunk?: TrunkShape;
	/** Roots that drop from the limbs and become pillars (banyan). */
	readonly aerialRoots?: AerialRoots;
	/** Clipping to a shape: hedges and topiary. */
	readonly clip?: Clip;
}

/**
 * A tree built in a set order, each step from the record alone: the stem, the foliage masses of the
 * crown packed inside the envelope, the great limbs that carry them, the branches that divide
 * inside each mass, and a socket at every branch end, which holds the foliage. The gaps between the
 * masses are the sky a viewer sees through the crown, and the socket count is the branch count.
 *
 * @category api/vegetation
 */
export interface Scaffold {
	/** The model's name. */
	readonly model: 'scaffold';
	/** One stem, or a stool of several that share the crown. */
	readonly stems: StemSpec;
	/** The stem below and through its division into great limbs. */
	readonly trunk: {
		/**
		 * The shares of the plant's height between which the great limbs leave the stem, lowest then
		 * highest. The stem ends at the highest: a low pair divides a short bole into a spreading
		 * crown, and a pair that runs to the top keeps one leader with limbs along it.
		 */
		readonly fork: readonly [from: number, to: number];
		/** Degrees the stem strays from its line as it rises, in slow curves. */
		readonly wander: number;
	};
	/** The crown's foliage masses: ellipsoids that stand against the envelope from inside. */
	readonly lobes: {
		/** Masses per plant. */
		readonly count: Spread;
		/**
		 * The share of the distance between two neighbouring masses that stays open, from 0, where
		 * neighbours touch, to 0.8. The open share is what shows sky through the crown and breaks its
		 * outline into lumps.
		 */
		readonly gap: number;
		/**
		 * The share of the masses that stand inside the crown, behind the gaps the outer ones leave,
		 * from 0, a hollow shell of foliage, to 0.5. They close the crown's middle to the sky without
		 * closing its outline.
		 */
		readonly inner: number;
		/** A mass's height over its width: below 1 a flat pad, above 1 a hanging strand. */
		readonly flatten: number;
		/** How much a mass's size varies from its neighbours', as a share of it, from 0 to 0.5. */
		readonly vary: number;
		/**
		 * The share of the plant's height below which no mass stands, from 0 to 0.9: the crown's
		 * underside, with sky and bare limbs under it.
		 */
		readonly floor: number;
	};
	/** The great limbs that leave the stem, each of which carries one group of masses. */
	readonly limbs: {
		/** Limbs per stem. */
		readonly count: Spread;
		/** How the limbs stand round the stem: a spiral by its divergence, or whorls of a count. */
		readonly arrangement: Phyllotaxis;
		/** Degrees the limbs' places round the stem vary by. */
		readonly jitter: number;
		/** Degrees between a limb and the stem's line where it leaves (t = 0 lowest limb, 1 highest). */
		readonly angle: Curve;
		/**
		 * Degrees above level that a limb runs at its end (t = 0 lowest limb, 1 highest). Below 0 the
		 * end dips.
		 */
		readonly end: Curve;
		/** How far a limb strays sideways from its curve, as a share of its length, in slow bends. */
		readonly wander: number;
	};
	/** The branches that run from a limb to each mass and divide inside it. */
	readonly branches: {
		/** The most degrees between a branch and its parent where it leaves. */
		readonly angle: number;
		/** Metres of one internode. */
		readonly step: number;
		/** The most degrees one internode turns from the last. */
		readonly turn: number;
		/** The least metres along a parent between two branches that leave it. */
		readonly spacing: number;
		/** How far each branch end turns toward the sky, from -1, hanging, through 0 to 1, upright. */
		readonly lift: number;
	};
	/** The sockets at the branch ends, each of which holds one piece of foliage. */
	readonly sockets: {
		/**
		 * Metres between two sockets, measured over the mass's surface, which their foliage covers.
		 * Fewer sockets are fewer branches.
		 */
		readonly spacing: number;
		/** Metres a socket stands inside its mass's surface: how far its foliage reaches past it. */
		readonly inset: number;
		/** The share of a mass's surface that carries sockets, its lit side, from 0.2 to 1. */
		readonly lit: number;
		/** Shoot rows that one socket holds. */
		readonly rows: Spread;
		/** Degrees the rows of one socket fan from its line. */
		readonly fan: number;
	};
	/** Pipe model: a parent's diameter to the exponent is the sum of its children's, and a socket twig's radius in metres. */
	readonly pipe: { readonly exponent: number; readonly tipRadius: number };
}

/**
 * The stems of a self-organizing or scaffold plant: one, or a stool of several.
 *
 * @category api/vegetation
 */
export interface StemSpec {
	/** Stems per plant. */
	readonly count: Spread;
	/** Degrees each stem leans from vertical. */
	readonly lean: Spread;
	/** Radius of the stool in metres. */
	readonly stool: number;
	/** Metres over which neighbouring stems stay fused. */
	readonly fused: number;
}

/**
 * A stem's own shape beyond its pipe radii.
 *
 * @category api/vegetation
 */
export interface TrunkShape {
	/** Radius times this curve by height (t = height / plant height): a baobab's bottle. */
	readonly profile?: Curve;
	/** Turns of spiral twist over the stem (olive). */
	readonly twist?: number;
	/** Slow bends, burrs and hollows, 0 to 1. */
	readonly gnarl?: number;
}

/**
 * Roots that drop from near-level limbs, bundle, and become load-bearing pillars where they reach
 * the ground.
 *
 * @category api/vegetation
 */
export interface AerialRoots {
	/** Roots per metre of limb within 30 degrees of horizontal and above `minHeight`. */
	readonly perMetre: number;
	/** Metres above the ground under which no root drops. */
	readonly minHeight: number;
	/** A root's radius in metres. */
	readonly radius: number;
	/** Roots closer than this many metres merge into one strand. */
	readonly bundle: number;
	/** Share that reach the ground and become pillars, and the share of limb load a pillar takes. */
	readonly pillars: { readonly share: number; readonly load: number };
	/** Metres a root sways from straight as it hangs. */
	readonly wave: number;
}

/**
 * Clipping to a solid, season after season: hedges and topiary.
 *
 * @category api/vegetation
 */
export interface Clip {
	/** The solid the plant is clipped to. */
	readonly shape: ShapeEnvelope;
	/** Clip-and-regrow cycles; clipping breaks apical dominance and fills the surface. */
	readonly seasons: number;
	/** Depth of the leafy shell in metres. */
	readonly shell: number;
	/** Share of shoots left uncut past the surface. */
	readonly sprigs: number;
}

/**
 * Rule-based architecture: a leader with tiers of boughs, numbers by position. Whorled and tiered
 * conifers.
 *
 * @category api/vegetation
 */
export interface Architectural {
	/** The model's name. */
	readonly model: 'architectural';
	/** The leader. */
	readonly leader: {
		/** Degrees the leader bends over its length. */
		readonly curve: number;
		/** Degrees the leader wanders. */
		readonly wander: number;
		/** Leaders after a fork near the top (old cedar), usually 1. */
		readonly count: Spread;
	};
	/** How boughs leave the leader. On every curve, t is the height in the crown (0 base, 1 top). */
	readonly tiers: {
		/** Boughs in whorls, in a spiral, or in flat plates. */
		readonly kind: 'whorl' | 'spiral' | 'plate';
		/** Metres between whorls (one year's growth), by height. */
		readonly spacing: Curve;
		/** Boughs per whorl. */
		readonly perWhorl: Spread;
		/** Small boughs between whorls, per metre. */
		readonly between: number;
		/** Lowest live bough as a share of height. */
		readonly start: number;
		/** The dead stubs below the lowest live bough: up to what share of height, and how many per metre. */
		readonly deadBelow: { readonly height: number; readonly stubs: number };
	};
	/** One entry per order from the bough down (index 0 = bough). */
	readonly orders: readonly ArchitecturalOrder[];
	/** Hanging second-order curtains (Norway spruce comb, larch). */
	readonly pendulous?: { readonly order: number; readonly length: Curve; readonly share: number };
	/**
	 * The pipe model that gives the wood its thickness: a parent's diameter to the exponent is the
	 * sum of its children's, and a terminal twig's radius in metres. The wood is then fitted to the
	 * species' diameter at 1.3 m. Absent, an exponent of 2.3 and a 5 mm twig are used.
	 */
	readonly pipe?: {
		readonly exponent: number;
		readonly tipRadius: number;
		/**
		 * The least share of its girth a stem keeps from one node to the next, from 0.5 to 1.
		 * Absent, 0.7, so a leader that carries the crown to the top is not outgrown by a whorl.
		 */
		readonly leader?: number;
	};
}

/**
 * One order of an architectural plant: how its axes leave their parent.
 *
 * @category api/vegetation
 */
export interface ArchitecturalOrder {
	/** Metres by position on the parent (t = 0 base, 1 tip), before the envelope caps it. */
	readonly length: Curve;
	/** Degrees from the parent, by position on the parent. */
	readonly angle: Curve;
	/** Children per metre of parent (per whorl for boughs), by position. */
	readonly density: Curve;
	/** How the children stand around the parent. */
	readonly arrangement: Phyllotaxis;
	/** 0 children all round; 1 children in the parent's plane (cedar plates, fir sprays). */
	readonly flatten: number;
	/** Degrees an axis sags under its own weight. */
	readonly sag: number;
	/** Degrees its tip turns up again. */
	readonly upturn: number;
	/** Degrees it bends over its length. */
	readonly curve: number;
}

/**
 * A plant built in a set order from a tree of axis rules: its stems and, under each, the axes that
 * leave it, with their counts, places, angles, bends, lengths and widths as the species measured
 * them, and a foliage patch on each axis whose rule states one. Every wood end that carries a patch
 * is a socket, in the scaffold model's own socket record.
 *
 * @category api/vegetation
 */
export interface Framed {
	/** The model's name. */
	readonly model: 'frame';
	/** The stems, the axes under them and the crown outline. */
	readonly frame: FrameSpec;
	/** What each socket holds: shoot rows as the scaffold model states them, or one branch piece. */
	readonly sockets: {
		/** Shoot rows that one socket holds. */
		readonly rows: Spread;
		/** Degrees the rows of one socket fan from its line. */
		readonly fan: number;
		/**
		 * The branch piece each socket carries, by its name among the record's pieces. Absent, a
		 * socket holds shoot rows.
		 */
		readonly piece?: string;
	};
}

/**
 * A conifer built in a set order from measured figures: one plumb trunk of a stated width at each
 * height, limbs at stated levels spread round it, each limb one smooth course through the direction
 * it leaves in, the direction it runs in and the direction it ends in, and a foliage patch at each
 * limb's end. The limb count is the record's own, so a check can hold it. Heights are shares of the
 * plant's height, from 0 at the ground to 1 at its top.
 *
 * @category api/vegetation
 */
export interface Conifer {
	/** The model's name. */
	readonly model: 'conifer';
	/** The trunk. */
	readonly trunk: {
		/** The trunk's width over the plant's height, by height. */
		readonly width: Curve;
		/**
		 * The height where the trunk ends and the top limbs carry on from it. At 1 the trunk runs to
		 * the plant's tip as one leader.
		 */
		readonly dividesAt: number;
		/** Degrees the trunk strays from plumb, in slow curves. */
		readonly wander: number;
	};
	/** The limbs that leave the trunk. */
	readonly limbs: {
		/** The heights of the limb levels, rising. */
		readonly levels: readonly number[];
		/** Limbs on the trunk, shared out over the levels as evenly as whole numbers allow. */
		readonly count: number;
		/** How far a limb may stand above or below its level, as a share of the plant's height. */
		readonly stagger: number;
		/** Degrees a limb's place round the trunk may stand off its level's even spacing. */
		readonly jitter: number;
		/** Degrees above level that a limb leaves the trunk at, by its height. Below 0 it leaves downward. */
		readonly leave: Curve;
		/** Degrees above level that a limb runs at through its middle, by its height. */
		readonly run: Curve;
		/** Degrees above level that a limb ends at, by its height. */
		readonly end: Curve;
		/**
		 * The distance from the trunk over which a limb turns from the way it leaves to the way it
		 * runs, as a share of the plant's height. A short limb takes at most half its length.
		 */
		readonly riseOver: number;
		/** The share of a limb's length, at its outer end, over which it turns to the way it ends. */
		readonly endOver: number;
		/**
		 * The crown's reach from the trunk's line on its wide side, over the plant's height, by
		 * height: the far edge of the longest limb's foliage at that height.
		 */
		readonly reach: Curve;
		/**
		 * The share of that reach a limb takes, by its place among the plant's limbs from the shortest
		 * (0) to the longest (1). The curve is the measured spread of limb lengths, so a crown keeps
		 * its few long limbs and its many short ones.
		 */
		readonly reachShare: Curve;
		/**
		 * The crown's plan: the built crown's narrow side over its wide side, from 0.5 to 1, measured
		 * over the foliage patches' far edges, and the degrees the wide side stands from +X. The
		 * grower stretches each limb's reach by its direction until the built crown has this share.
		 */
		readonly plan: { readonly narrow: number; readonly turn: number };
		/**
		 * A limb's radius beside the trunk over the trunk's radius at that height, for the shortest
		 * limb and for the longest. A limb between them takes its place by its reach.
		 */
		readonly radius: readonly [short: number, long: number];
		/**
		 * The swelling where a limb meets the trunk: how many times the limb's own radius it is
		 * there, and the distance over which it fades, as a share of the plant's height.
		 */
		readonly collar: { readonly swell: number; readonly over: number };
		/**
		 * A limb's radius where its foliage patch begins, over its radius past the collar. Under the
		 * patch the limb thins on to its end.
		 */
		readonly taper: number;
		/** The most degrees a limb's sideways sway turns it from its course, in slow bends. */
		readonly wander: number;
		/**
		 * The arms a limb divides into under its foliage patch: how many, the degrees each leaves at
		 * from the limb, to one side and the other in turn, and its radius over the limb's there.
		 */
		readonly arms: { readonly count: number; readonly angle: number; readonly radius: number };
	};
	/**
	 * The limbs that carry on where the trunk divides, spread evenly round it: how many, the degrees
	 * above level they leave and end at, and each one's radius over the trunk's where it divides.
	 * The way each runs through its middle is solved so that its foliage patch's top stands at the
	 * plant's height, the first one's at the height and each further one's a step lower. With a
	 * leader, the first limb carries on as the plant's leader: it reaches that share as far as the
	 * crown does there, and its patch stands over the trunk's line. Absent on a plant whose trunk
	 * runs to its tip.
	 */
	readonly top?: {
		readonly limbs: number;
		readonly leave: number;
		readonly end: number;
		readonly radius: number;
		readonly leader?: number;
	};
	/** The foliage patch at a limb's end, which the sockets of its foliage fill. */
	readonly patch: {
		/** A level plate on top of the limb's end, a dome round it, or a tile of a closed shell. */
		readonly kind: 'pad' | 'dome' | 'shell';
		/**
		 * One patch a limb, which the limb's arms spread under, or one patch at the limb's end and one
		 * at each arm's end, each apart from the next.
		 */
		readonly each: 'limb' | 'end';
		/**
		 * The patch's width over the plant's height, for the shortest limb and for the longest. A
		 * patch takes at most seven tenths of its limb's reach.
		 */
		readonly width: readonly [short: number, long: number];
		/**
		 * Where one patch a limb: the share of the limb's reach, at its outer end, that the patch
		 * lies along. The patch is then that long along its limb and no wider than it is long, so
		 * the foliage clothes the limb's outer part and its inner part stays bare. Absent, a patch
		 * is round and takes at most a stated share of its limb's reach.
		 */
		readonly along?: number;
		/** The patch's depth over its width. */
		readonly depth: number;
		/**
		 * The sockets that fill a patch: the piece each carries, by its name among the record's
		 * pieces, the metres between one socket and the next over the patch's dome, and the most
		 * degrees above level that a piece leaves its socket at, where the dome faces the sky.
		 * Absent, a patch carries no socket.
		 */
		readonly sockets?: {
			readonly piece: string;
			readonly pitch: number;
			readonly lift: number;
		};
	};
}

/**
 * A stem crowned by a spiral of large leaves: palms and tree ferns.
 *
 * @category api/vegetation
 */
export interface CrownRosette {
	/** The model's name. */
	readonly model: 'crown-rosette';
	/** The stem. */
	readonly stem: {
		/** Stem height in metres. */
		readonly height: Spread;
		/** Radius in metres by height (t = height / stem height). */
		readonly radius: Curve;
		/** Degrees the stem leans. */
		readonly lean: Spread;
		/** Degrees the stem bends over its height (coconut). */
		readonly curve: Spread;
		/** Extra stems from the base (date palm suckers). */
		readonly suckers?: Spread;
		/** What old leaves leave on the stem; derived from the same frond spiral. */
		readonly surface: 'ring-scars' | 'leaf-bases' | 'root-mat' | 'smooth';
	};
	/** The crown of fronds. */
	readonly crown: {
		/** Living fronds. */
		readonly fronds: Spread;
		/** Degrees between successive fronds, 137.5 for most. */
		readonly divergence: number;
		/** Degrees from vertical by frond age (t = 0 youngest, 1 oldest living). */
		readonly tilt: Curve;
		/**
		 * Metres of the stem over which the frond bases clasp it, newest lowest: a crown springing
		 * from a band of the stem, or from a single growing point at 0. Absent, the model's own
		 * depth, which suits a tall palm's crown.
		 */
		readonly depth?: number;
		/**
		 * Croziers: a fern's young fronds, still rolled at their tips. Their number, the length of
		 * their stalk in metres, and the degrees their head coils through as it unrolls. Absent,
		 * the crown carries none, as a palm's does.
		 */
		readonly croziers?: {
			readonly count: Spread;
			readonly length: Spread;
			readonly coil?: number;
			/**
			 * Metres of radius at a crozier's foot: a fiddlehead is thick and fleshy, wider than the
			 * stipe of the frond it will become. Absent, it takes the frond's own stipe width.
			 */
			readonly radius?: number;
			/**
			 * What a crozier's skin draws: `young`, the smooth young bark a thin shoot takes, or
			 * `grown`, the species' grown bark layer with its zones, tint and hollows. A rolled
			 * young frond is fleshy and hairy rather than smooth, so `grown` is what a fern's
			 * fiddlehead takes. Absent, `young`, which changes no record that names no croziers.
			 */
			readonly bark?: 'young' | 'grown';
		};
		/**
		 * Dead fronds: count, how far they hang, and a skirt that hides the stem top (fan palm).
		 * `blades` keeps a dead frond's leaflets at the level's detail, as a tree fern's dead skirt
		 * shows its pinnae; absent, a dead frond reads as a brown mass at the coarsest detail, as a
		 * palm's skirt does. `length` is the share of a living frond's length that a dead frond
		 * keeps, above 0 and at most 1; absent, a dead frond keeps nearly all of it, as a palm's
		 * does.
		 */
		readonly dead: {
			readonly count: Spread;
			readonly hang: number;
			readonly skirt: number;
			readonly blades?: boolean;
			readonly length?: number;
		};
	};
	/** One frond. */
	readonly frond: FrondShape;
}

/**
 * One frond: a rachis with leaflets, recursively, or a fan of pleated segments.
 *
 * @category api/vegetation
 */
export interface FrondShape {
	/** How the frond divides. */
	readonly kind: 'pinnate' | 'bipinnate' | 'tripinnate' | 'fan' | 'costapalmate';
	/** Blade length in metres. */
	readonly length: Spread;
	/** The stalk: metres long and wide, and teeth per metre. */
	readonly petiole: { readonly length: number; readonly width: number; readonly teeth: number };
	/** Droop along the rachis (t = along the rachis). */
	readonly droop: Curve;
	/** Degrees of twist along the rachis. */
	readonly twist: number;
	/** The leaflets of a pinnate frond. */
	readonly pinnae?: PinnaSpec;
	/** The segments of a fan frond. */
	readonly fan?: {
		/** Segments per frond. */
		readonly segments: Spread;
		/** Share of the radius where segments split. */
		readonly split: number;
		/** The pleat's depth. */
		readonly pleat: number;
		/** White fibres between segments (Washingtonia). */
		readonly threads: number;
	};
}

/**
 * The leaflets along a rachis, and the next order down.
 *
 * @category api/vegetation
 */
export interface PinnaSpec {
	/** Leaflets per side. */
	readonly count: Spread;
	/** Leaflet length over blade length, by position along the rachis. */
	readonly length: Curve;
	/** Degrees between leaflet and rachis, by position. */
	readonly angle: Curve;
	/** Planes the leaflets stand in: 1 flat, 2 to 4 for a V-section frond (date palm). */
	readonly planes: number;
	/** Fold of each leaflet in degrees: positive V up (induplicate), negative down. */
	readonly fold: number;
	/** Degrees each leaflet droops. */
	readonly droop: number;
	/** Spines in place of the lowest leaflets. */
	readonly spines: number;
	/**
	 * What the species' leaf picture holds, which sets how a crown rosette's frond draws each
	 * leaflet. `pinna`: a divided leaflet whose picture carries its own lobes, as a tree fern's
	 * does. Each place on the rachis carries a pair of them at the picture's own width, the
	 * picture is sampled across the leaflet, and a piece cut from the frond keeps the leaflets
	 * of the place it was cut from. `blade`: one narrow simple leaflet, as a date palm's is.
	 * Each place carries one, drawn wider than its picture where the frond stands far so the
	 * crown keeps its cover, its colour comes from the picture's midrib, and a short piece cut
	 * from the frond sets its leaflets at a close photograph's own spacing. Absent, `pinna`.
	 */
	readonly leaflet?: 'pinna' | 'blade';
	/** The next order down, for bipinnate and tripinnate fronds. */
	readonly sub?: PinnaSpec;
}

/**
 * Bamboo: jointed culms, branch complements at nodes, leaf sprays.
 *
 * @category api/vegetation
 */
export interface Culm {
	/** The model's name. */
	readonly model: 'culm';
	/** Culms per plant. */
	readonly culms: Spread;
	/** A tight clump, or culms along runners. */
	readonly layout: 'clump' | 'running';
	/** Clump radius, or spacing along runners, in metres. */
	readonly spacing: number;
	/** Culm height in metres. */
	readonly height: Spread;
	/** Culm diameter in metres. */
	readonly diameter: Spread;
	/** Internode metres by height (t = height / culm height): short low, long mid, short top. */
	readonly internode: Curve;
	/** The node: ridge, wax band and sheath scar, each in metres. */
	readonly node: { readonly ridge: number; readonly waxBand: number; readonly sheathScar: number };
	/** The branch complement at each node. */
	readonly branches: {
		/** Lowest branching node as a share of culm height. */
		readonly from: number;
		/** Branches per node. */
		readonly perNode: Spread;
		/** One branch larger than the rest at each node (Phyllostachys). */
		readonly dominant: boolean;
		/** Branch length in metres by height on the culm. */
		readonly length: Curve;
		/** Degrees between branch and culm. */
		readonly angle: number;
		/** Branch orders. */
		readonly orders: number;
	};
	/** Groove above each branch, as a share of the radius. */
	readonly sulcus: number;
	/** Sheaths up to this share of height, each this long in metres. */
	readonly sheaths: { readonly upTo: number; readonly length: number };
	/** Degrees the culm arches over its height. */
	readonly arch: Spread;
}

/**
 * Leaves on long stalks from one crown that has divided into shoots, each shoot a golden-angle spiral
 * of leaves, with flowering scapes in season: hosta.
 *
 * @category api/vegetation
 */
export interface Rosette {
	/** The model's name. */
	readonly model: 'rosette';
	/** Shoots (eyes) the crown has divided into; each carries its own spiral of leaves. */
	readonly shoots: Spread;
	/** Radius in metres of the ring the shoots stand on round the crown's centre. */
	readonly crown: number;
	/** Leaves per shoot, the rolled young ones among them. */
	readonly leaves: Spread;
	/** Degrees between successive leaves of a shoot. */
	readonly divergence: number;
	/** Degrees from vertical at a stalk's base, by leaf age (t = 0 youngest, 1 oldest). */
	readonly tilt: Curve;
	/** Degrees a stalk bends outward and down over its length, by leaf age. */
	readonly arch: Curve;
	/** Stalk length in metres, by leaf age. */
	readonly stalk: Curve;
	/** Blade length over the foliage's leaf length, by leaf age: young leaves are small. */
	readonly size: Curve;
	/** Degrees the blade turns down from its stalk's line where it joins it, by leaf age. */
	readonly pitch: Curve;
	/** Share of each shoot's leaves, the youngest, that are still rolled. */
	readonly rolled: number;
	/** Extra degrees of tilt in autumn, when the leaves collapse toward the ground. */
	readonly collapse: number;
	/** Bare flowering stems in the seasons they name, each carrying the record's flower extras. */
	readonly scapes?: {
		/** Scapes per plant. */
		readonly count: Spread;
		/** Height in metres. */
		readonly height: Spread;
		/** Radius at the base in metres. */
		readonly radius: number;
		/** Degrees from vertical. */
		readonly lean: Spread;
		/** Share of the scape, from its top, that carries flowers. */
		readonly raceme: number;
		/** Flowers per scape, all on one side. */
		readonly flowers: Spread;
		/** The seasons the scapes stand in. */
		readonly seasons: readonly Season[];
	};
}

/**
 * Fronds rising singly along buried rhizomes: bracken.
 *
 * @category api/vegetation
 */
export interface FrondColony {
	/** The model's name. */
	readonly model: 'frond-colony';
	/** Fronds per colony. */
	readonly fronds: Spread;
	/**
	 * The patch the fronds' feet stand in, spread evenly over an ellipse: its long and its short
	 * width, as shares of the plant's height.
	 */
	readonly patch: { readonly long: number; readonly short: number };
	/** The buried rhizome that joins the feet: metres under the soil, and its radius in metres. */
	readonly rhizome: { readonly depth: number; readonly radius: number };
	/**
	 * A frond's size as a share of the tallest frond's: the range most fronds take, the range the
	 * short fronds take, and the short fronds' share of the patch. The short fronds stand at the
	 * patch's front edge, toward +Z.
	 */
	readonly heights: {
		readonly tall: readonly [number, number];
		readonly short: readonly [number, number];
		readonly shortShare: number;
	};
	/**
	 * The tallest frond's stalk, in metres; the degrees a stalk leans from plumb; and the radius
	 * of the one curve in which its top turns over to hold the leaf, as a share of its length. A
	 * frond's stalk is this length at the frond's own size.
	 */
	readonly stipe: { readonly length: Spread; readonly lean: Spread; readonly bend: number };
	/**
	 * Degrees above level that a stalk's end holds its leaf's midrib at, the least and the most.
	 */
	readonly tilt: readonly [number, number];
	/** The fewest fronds a thinned patch keeps. */
	readonly least: number;
	/** One frond. */
	readonly frond: FrondShape;
	/** Young fronds still rolled. */
	readonly croziers: Spread;
}

/**
 * A tuft sheath column's colours: the colour at its foot and the colour where the blades leave,
 * mixed up the column, so a crown draws its own colour at the soil and the collar's colour above.
 *
 * @category api/vegetation
 */
export interface SheathColour {
	/** The colour at the column's foot, in linear reflectance. */
	readonly foot: Rgb;
	/** The colour at the column's collar, in linear reflectance. */
	readonly collar: Rgb;
	/** The share of the column's height below its collar over which the collar's colour takes over. */
	readonly reach: number;
}

/**
 * A tuft of shoots on one stool, each shoot a column of sheaths with blades in two or three ranks,
 * and flowering stems in season: grasses and sedges. The plant's height is its one scale: the leaf
 * mound's height is a share of it, and every other length here is a share of the mound's height.
 * The stool's sheath columns are the plant's frame; each blade and each flowering stem is a piece
 * of the kit, placed whole at a socket.
 *
 * @category api/vegetation
 */
export interface Tuft {
	/** The model's name. */
	readonly model: 'tuft';
	/** The leaf mound's height as a share of the plant's height. */
	readonly mound: number;
	/** Shoots (tillers) on the stool. */
	readonly shoots: Spread;
	/** The stool's width at the soil, in mound heights. */
	readonly stool: number;
	/** A shoot's column of sheaths: its height and its width at the foot, in mound heights. */
	readonly sheath: { readonly height: number; readonly width: number };
	/**
	 * The sheath column's colours, where the photographs show the plant's own sheaths rather than the
	 * leaf's green: the stool draws its columns in them, from the foot up to the collar.
	 */
	readonly sheathColour?: SheathColour;
	/** Blades per shoot. */
	readonly blades: Spread;
	/** Ranks the blades stand in round their shoot: 2 for grasses, 3 for sedges. */
	readonly ranks: number;
	/** The poses a blade takes, the youngest first. Each is a piece of its own. */
	readonly poses: readonly TuftPose[];
	/** How far a blade's length strays either side of its pose's, as a share of it. */
	readonly bladeSpread: number;
	/** Flowering stems and the heads they carry. */
	readonly stalks?: TuftStalks;
	/** The least a thinned plant keeps: shoots, blades on each shoot, and flowering stems. */
	readonly least: { readonly shoots: number; readonly blades: number; readonly stalks: number };
	/**
	 * The stool's hold in the soil: a short rhizome and the roots that leave it, in metres, for a
	 * plant whose photographs show them. Absent, the stool draws nothing under the shoots.
	 */
	readonly soil?: TuftSoil;
}

/**
 * What a tuft draws under its shoots: a rhizome lying at the soil's surface and the roots that leave
 * it. A tufted grass leaves the rhizome absent and draws fibrous roots; a sedge shows both.
 *
 * @category api/vegetation
 */
export interface TuftSoil {
	/** Half the rhizome's length, from the crown to either end, in metres; absent draws no rhizome. */
	readonly rhizome?: Spread;
	/** The rhizome's radius in metres, at most the crown's own radius. */
	readonly rhizomeRadius?: number;
	/** Roots that leave the crown and the rhizome. */
	readonly roots: Spread;
	/** A root's length in metres. */
	readonly rootLength: Spread;
	/** A root's radius where it leaves the crown, in metres: it tapers to a point. */
	readonly rootRadius: number;
	/** Degrees a root leaves the horizontal, downward, by its own draw. */
	readonly droop: Spread;
}

/**
 * One pose of a tuft's blade, as measured on a photograph, in mound heights.
 *
 * @category api/vegetation
 */
export interface TuftPose {
	/**
	 * The share of a shoot's blades, by age, that the pose stands for. The pose itself is the blade
	 * at the middle of that share; a blade between two poses' middles takes a shape between them.
	 */
	readonly share: number;
	/** Degrees above the horizontal that the blade leaves its sheath at. Left out, the fit finds it. */
	readonly leave?: number;
	/** How far the blade's highest point stands above its collar. */
	readonly apex: number;
	/**
	 * How far its tip ends below its highest point. A drop as great as the highest point brings the
	 * blade down to the soil: it meets the soil where its point begins, and the point runs on.
	 */
	readonly drop: number;
	/** How far out from its collar its tip ends. */
	readonly reach: number;
	/**
	 * Degrees below the horizontal that the blade's tip points at, from 0 to 90, where the
	 * photograph shows it. Left out, the fit finds it.
	 */
	readonly tip?: number;
}

/**
 * The flowering stems of a tuft, in mound heights. A stem and its head are one piece of the kit.
 *
 * @category api/vegetation
 */
export interface TuftStalks {
	/** Flowering stems per tuft. */
	readonly count: Spread;
	/** The seasons the stems stand in. */
	readonly seasons: readonly Season[];
	/** The height of a stem's highest point above the soil: the shortest stem's and the tallest's. */
	readonly top: readonly [number, number];
	/** Degrees a stem leans from plumb: at the stool's middle and at its rim. */
	readonly lean: readonly [number, number];
	/**
	 * The stem's bow: the share of its length that runs straight before it, and the degrees it turns
	 * over the rest, at the stool's middle and at its rim.
	 */
	readonly bow: { readonly from: number; readonly turn: readonly [number, number] };
	/** The stem's width at its foot. */
	readonly width: number;
	/** Faces round the stem: 3 for a sedge's three-angled stem, more for a round culm. */
	readonly sides: number;
	/** What the stem carries. */
	readonly head: TuftSpikes | TuftPanicle;
}

/**
 * A sedge's head: spikes hanging plumb one below another along the stem's bow, and one at its tip.
 *
 * @category api/vegetation
 */
export interface TuftSpikes {
	/** The kind of head. */
	readonly kind: 'spike';
	/** Hanging spikes on a stem. */
	readonly count: number;
	/** A spike's length, in mound heights. */
	readonly length: number;
	/** A spike's width, in mound heights. */
	readonly width: number;
	/** The length of the thread a spike hangs on. */
	readonly thread: number;
	/** The length of the spike that ends the stem, on the stem's own line. */
	readonly tip: number;
	/**
	 * Where the hanging spikes leave the bowed stem: the degrees above level that the stem points
	 * where the highest leaves and where the lowest leaves, one below another between them.
	 */
	readonly hang: readonly [number, number];
}

/**
 * A grass's head: an open pyramid of branches in whorls up the stem's top, each ending in a
 * cluster of spikelets.
 *
 * @category api/vegetation
 */
export interface TuftPanicle {
	/** The kind of head. */
	readonly kind: 'panicle';
	/** The head's length, in mound heights. */
	readonly length: number;
	/** The head's width at its lowest whorl, in mound heights. */
	readonly width: number;
	/** Whorls of branches up the head. */
	readonly whorls: number;
	/** Branches in a whorl. */
	readonly branches: number;
	/** Degrees a branch leaves the stem at. */
	readonly angle: number;
	/** Spikelets in a branch's cluster. */
	readonly spikelets: number;
	/** A spikelet's length, in mound heights. */
	readonly spikelet: number;
}

/**
 * One tier of a column's arms: where they leave, how far out they stand and where they end.
 *
 * @category api/vegetation
 */
export interface ColumnArmTier {
	/** The share of the plant's height where the tier's arms leave the column. */
	readonly at: Spread;
	/** Metres from the column's axis to the axis of an arm's upright part. */
	readonly reach: Spread;
	/** The share of the plant's height where an arm's tip ends. */
	readonly top: Spread;
	/** An arm's radius in metres: above its bend, and at its tip. */
	readonly radius: readonly [number, number];
}

/**
 * A ribbed column with arms: saguaro.
 *
 * @category api/vegetation
 */
export interface Column {
	/** The model's name. */
	readonly model: 'column';
	/** Height in metres, to the top of the column's rounded end. */
	readonly height: Spread;
	/** Radius in metres by height (t = height / plant height), below the rounded end. */
	readonly radius: Curve;
	/** The height of the rounded end of the column and of each arm, in radii of the wood below it. */
	readonly dome: number;
	/** Ribs around the column. */
	readonly ribs: Spread;
	/** How deep a groove cuts between two ribs, as a share of the radius there, from 0 to 1. */
	readonly ribDepth: number;
	/** The arms. */
	readonly arms: {
		/** Arms per plant. */
		readonly count: Spread;
		/** The tiers, lowest first. The grower deals the arms among them in turn. */
		readonly tiers: readonly ColumnArmTier[];
		/**
		 * How many of the species' variants, from the first, stand their arms in one upright plane, a
		 * tier's worth to one side and the next to the other. The plane stands across the view from
		 * +Z, so a whole picture taken from there shows every arm. The rest spread their arms
		 * evenly through the full circle. A variant in one plane is not balanced round its column,
		 * so a record that names any says in its comment which photograph shows it.
		 */
		readonly plane: number;
		/** Ribs round an arm, which carries fewer than the column does. */
		readonly ribs: Spread;
		/** Degrees above the horizontal that an arm leaves the column at; a negative angle sags. */
		readonly leave: number;
		/**
		 * The radius of an arm's elbow at its centre line, in arm widths. An arm whose reach leaves
		 * less room than that turns as tightly as its own girth allows.
		 */
		readonly elbow: number;
		/** An arm's girth where it meets the column, as a share of its girth above the bend. */
		readonly pinch: number;
		/** An arm's girth in its bend, as a multiple of its girth above the bend. */
		readonly swell: number;
	};
	/** Metres between areoles on a rib crest; each carries a spine-cluster prototype. */
	readonly areoles: number;
}

/**
 * The outline a plant fills: measured radii by height, or a solid.
 *
 * @category api/vegetation
 */
export type Envelope = RadialEnvelope | ShapeEnvelope;

/**
 * The outline a plant fills, measured from its reference turntable: radius over the plant's height
 * at rising heights, round in plan or one radius per azimuth.
 *
 * @category api/vegetation
 */
export interface RadialEnvelope {
	/** The envelope's kind. */
	readonly kind: 'radial';
	/** Heights as shares of the plant's height, rising, from the lowest foliage to the top. */
	readonly heights: readonly number[];
	/**
	 * Radius over the plant's height at each height: one number for a crown round in plan, or 8 or
	 * 16 numbers, one per azimuth, from +X turning toward +Z. Each variant turns the azimuths by its
	 * own hashed angle, so copies of different variants differ in plan.
	 */
	readonly radii: readonly (number | readonly number[])[];
	/** How the numbers were measured, so the reviewer can repeat it. */
	readonly source: {
		/** The method. */
		readonly method: 'turntable-hull' | 'profile' | 'hand';
		/** The reference file, such as 'pedunculate-oak-turntable.mp4'. */
		readonly from: string;
		/** Views the measure read. */
		readonly views?: number;
		/**
		 * Stills that bound the crown's broad sides, with the turn the review draws each at, in
		 * degrees round the plant. Turn 0 looks from +Z.
		 */
		readonly stills?: readonly { readonly file: string; readonly turn: number }[];
	};
}

/**
 * A solid the plant fills or is clipped to, in metres.
 *
 * @category api/vegetation
 */
export interface ShapeEnvelope {
	/** The envelope's kind. */
	readonly kind: 'shape';
	/** The solid. */
	readonly shape: Sdf;
}

/**
 * A solid by its signed distance: a box, an ellipsoid, a cone, a cylinder, a spiral, or a union of
 * them, in metres about the plant's base.
 *
 * @category api/vegetation
 */
export type Sdf =
	| { readonly box: Vec3; readonly round: number }
	| { readonly ellipsoid: Vec3 }
	| { readonly cone: { readonly radius: number; readonly height: number } }
	| { readonly cylinder: { readonly radius: number; readonly height: number } }
	| {
			readonly spiral: {
				readonly radius: number;
				readonly height: number;
				readonly turns: number;
				readonly thickness: number;
			};
	  }
	| { readonly union: readonly (Sdf & { readonly at?: Vec3 })[] };

/**
 * How leaves or buds stand along a shoot.
 *
 * A two-ranked shoot may turn each node's leaf past the opposite rank by `turn` degrees. A small
 * turn keeps the shoot reading as two ranks and spreads its blades out of one plane, so the spray
 * keeps its height as it turns. Zero, or no turn named, draws strict two ranks.
 *
 * @category api/vegetation
 */
export type Phyllotaxis =
	| { readonly kind: 'spiral'; readonly divergence: number }
	| { readonly kind: 'distichous'; readonly flatten: number; readonly turn?: number }
	| { readonly kind: 'opposite'; readonly decussate: boolean }
	| { readonly kind: 'whorled'; readonly count: number }
	| { readonly kind: 'fascicle'; readonly needles: number }
	| { readonly kind: 'rosette-spur'; readonly leaves: Spread };

/**
 * The shoot prototypes of a species: small real shoots with stems, buds and leaves, grown once per
 * species and instanced on every variant's bud sites. They carry the finest 1 to 3 orders.
 *
 * @category api/vegetation
 */
export interface ShootSpec {
	/** Prototypes per species, 4 to 12, split over the classes by share. */
	readonly prototypes: number;
	/** The kinds of shoot, each serving a range of bud vigor. */
	readonly classes: readonly ShootClass[];
	/**
	 * Shoots the cuttings draw and the crown never does, each with one prototype of its own. A close
	 * picture of a cut twig wants shorter, denser twigs than the crown can carry on the same class, and
	 * a class of its own settles the two without either paying for the other. A name here must not also
	 * be one of `classes`. The list's order sets each class's prototypes, because a shoot's growth seed
	 * is its place in the kit, so a new class goes after every existing one: adding one before them
	 * redraws theirs, and a species' cluster piece moved from 86x283 to 177x287 when a class was added
	 * at the top.
	 */
	readonly cuttingClasses?: readonly ShootClass[];
	/**
	 * Leaf or needle arrangement along a shoot. A two-ranked shoot keeps its laterals in the plane of
	 * its leaf ranks; a spiral shoot turns them by the golden angle.
	 */

	readonly phyllotaxis: Phyllotaxis;
	/** Orders inside one prototype, 1 to 3. */
	readonly orders: number;
	/** Years of growth in one prototype. */
	readonly years: number;
	/** Leaves or needles stand on the newest this many years only (pine tufts). */
	readonly leafYears: number;
	/** The shoot's stem. */
	readonly stem: {
		/** Stem radius in metres at the shoot's base and tip. */
		readonly radius: readonly [base: number, tip: number];
		/** Degrees of zigzag at each node (sympodial twigs: elm, lime, hazel, beech). */
		readonly zigzag: number;
	};
	/** The buds at the axils and the tip. */
	readonly bud: {
		/** Bud length in metres. */
		readonly length: number;
		/** Bud width in metres. */
		readonly width: number;
		/** Buds crowded at the shoot tip (oak). */
		readonly tipCluster: number;
		/**
		 * How the tip cluster's buds below the terminal one stand round it: `step`, how far each stands
		 * below the last along the twig as a share of a bud's length, 0 to 1, and `lean`, the degrees
		 * each leans out from the terminal bud, 0 to 80. A short step and a wide lean gather them into
		 * the round bunch an oak's twig tip carries. Without it the step is 0.4, which strings them
		 * down the twig's last centimetres, and the lean 32.
		 */
		readonly cluster?: { readonly step: number; readonly lean: number };
		/** The buds' linear colour, which takes the young bark's pattern; the young bark's own when not given. */
		readonly colour?: Rgb;
	};
	/** Where shoots attach to a variant. */
	readonly placement: {
		/** Shoots per metre of the finest macro axes, by bud vigor (t = vigor). */
		readonly perMetre: Curve;
		/**
		 * How dense the foliage sits against the curve above, 1 by the curve's own figure. This is
		 * the dial for a crown too thin for its reference: raising it puts more shoots along the
		 * finest axes without changing their reach or the species' part sizes.
		 */
		readonly density?: number;
		/**
		 * How far the shoots gather towards the end of the axis that carries them, 0 to 1. At 0 they
		 * stand evenly along it; at 1 they crowd at its end and the stretch behind thins. A crown
		 * that answers its reference's masses puts its foliage at the axes' ends, which also dresses
		 * each limb's tip, where a bare run otherwise stands past the leaves.
		 */
		readonly tipBias?: number;
		/**
		 * No shoot where sky visibility is below this: shade pruning. An axis's end bud is spared: it
		 * keeps its rosette unless it stands in less light than the tip line.
		 */
		readonly shadePrune: number;
		/**
		 * The sky visibility under which an axis's end bud loses the rosette it is otherwise always
		 * given, 0 to 1: a tip this dark is a twig that starved inside the crown, so it bears only
		 * the shoots its vigor and stretch give it, and the limbs between the foliage masses show.
		 * Absent, every end bud keeps its rosette.
		 */
		readonly tipPrune?: number;
		/**
		 * No shoot, a tip's rosette among them, where the finished crown's own leaves leave it less
		 * than this share of the sky, 0 to 1. The shade-prune line reads the light the growth saw,
		 * which a bud's own neighbours set, and spares a lit tip; this line reads the whole crown's
		 * leaf mass once every shoot stands, so the inside of a thick mass and the shaded underside
		 * thin while the lit surface stays. Absent or 0, no shoot goes by it.
		 */
		readonly skyPrune?: number;
		/**
		 * The depth in metres of the height layers a sky-prune line reads within, from 0.25 to 5:
		 * given, the line is a share of the sky the best-lit tenth of the shoots at a shoot's own
		 * height see, so every height keeps its lit outer shoots and loses its shaded inner ones, and
		 * the crown's underside keeps its rim while its middle opens. Absent, the line is a share of
		 * the whole sky.
		 */
		readonly skyPruneLayer?: number;
		/**
		 * The thickest wood that is trimmed away where it bears no shoot, as a radius in metres, 0 to
		 * 0.1: once the shoots stand, a branch's wood no thicker than this goes past the last node that
		 * bears a shoot or carries a branch that stays, and a branch left with nothing goes. A twig
		 * whose every shoot was pruned or starved has died rather than standing bare under the crown.
		 * Absent or 0, the wood stays as it grew.
		 */
		readonly bareTrim?: number;
		/**
		 * Whether a branch end with no shoot is cut back to its last shoot, so no branch ends bare:
		 * it ends in foliage or is pruned away. On when absent. A stem's own top and a dead stub
		 * stay; false keeps only `bareTrim`'s radius-limited trim.
		 */
		readonly bareEnds?: boolean;
		/**
		 * A bare column round each stem below a share of the plant's height: no shoot stands on wood
		 * within `radius` metres of a stem's own axis below `height` times the plant's height. An
		 * open-grown tree leaves its lower trunk and the bases of its great limbs clear, so the bole
		 * reads through the crown while the skirt's outer foliage still hangs low. Absent, shoots
		 * stand on every axis.
		 */
		readonly bareBole?: {
			/** Metres from the stem's axis within which no shoot stands. */
			readonly radius: number;
			/** The share of the plant's height below which the column holds. */
			readonly height: number;
		};
		/**
		 * Degrees each shoot turns toward the sky from the way it leaves its wood, from -30 to 30,
		 * negative toward the ground. Absent, the turn comes from the finest order's tropism.
		 */
		readonly lift?: number;
		/**
		 * Degrees each shoot turns away from the wood that carries it, on top of the angle the
		 * record's buds give, from 0 to 60. A crown whose foliage stands against its twigs opens as
		 * its shoots reach further out, and the shoots keep their feet on the wood: 0 by default,
		 * the angle the buds' own curve sets.
		 */
		readonly reach?: number;
		/** How far a shoot turns its leaves toward the sky, 0 to 1 (flat beech sprays). */
		readonly skyward: number;
		/**
		 * How a crowded tip stands its leaves. Round, the default, divides the turn evenly so the
		 * cluster reads the same from every side; fan spreads them in the stem's own plane, so the
		 * rosette is one flat face of blades, as an oak's is when its leaves are looked at front on.
		 */
		readonly rosette?: 'round' | 'fan';
		/**
		 * Whether a run of crowded nodes stands its blades in one plane and overlaps them in order,
		 * as a shingle. The internode curve marks a run by crowding its nodes; without this, each
		 * blade of the run still turns with the stem's own zigzag and the run reads as a tuft. Set,
		 * the run's face is the first crowded node's and every blade of the run keeps it. Off, a
		 * shoot draws exactly as it did.
		 */
		readonly plate?: boolean;
		/** A shoot's scale. */
		readonly scale: Spread;
		/**
		 * A multiplier on each shoot's scale by the shoot's height in the crown, 0 at the crown's
		 * base and 1 at the plant's top: a limb carries its own shoot length, so a crown may widen
		 * its skirt and shorten its top without moving the crown's foot. Absent, every shoot takes
		 * the species' one scale.
		 */
		readonly scaleByHeight?: Curve;
		/**
		 * The share of the internode back from a bud that its shoots may stand in, 0 to 1. Small,
		 * they gather into a tuft at the node and the internode between nodes stands bare; 1, they
		 * spread over the whole internode and the axes carry leaves the length of their run.
		 */
		readonly gather?: number;
		/**
		 * The most shoot rows one axis carries. Above it the rows thin evenly along the axis, so a
		 * crown with fewer branches opens rather than giving the leaves their places. Absent, an axis
		 * carries every row its buds place.
		 */
		readonly rowsPerAxis?: number;
		/**
		 * The share of a card's leaf groups that stays, 0 to 1. Below 1 a hashed share of the crown's
		 * leaf groups gives way, so the crown shows sky between them while the leaves of the rest keep
		 * their mass. Absent or 1, the card draws whole.
		 */
		readonly cardCoverage?: number;
		/**
		 * Gathers the shoots into masses along each axis, with a thinner run between them, so the
		 * crown is built of clumps with sky and wood between rather than an even mesh of leaves.
		 * Absent, the shoots stand evenly spaced. The masses of neighbouring axes do not line up,
		 * so the crown's clumps are not rows.
		 */
		readonly clump?: {
			/** Metres from one mass of shoots to the next along an axis. */
			readonly spacing: number;
			/** How far the shoots thin between masses, 0 even and 1 bare. */
			readonly depth: number;
			/**
			 * A second, finer scale over the same crown: masses within a mass, so the foliage of one
			 * plate reads as tufts with wood between them. The coarse scale sets the plates' gaps and
			 * the fine scale sets the crown's grain; one scale cannot do both.
			 */
			readonly fine?: {
				/** Metres from one tuft to the next. */
				readonly spacing: number;
				/** How far the shoots thin between tufts, 0 even and 1 bare. */
				readonly depth: number;
			};
		};
		/**
		 * Places the crown's foliage on the plant's own limb masses, so the sky between them shows
		 * through the crown. A shoot keeps its full density near wood of `order` or coarser, and
		 * thins with its distance from that wood: the foliage stands on the great limbs and their
		 * branches, and the space between one mass and the next stays open through the crown.
		 * Absent, the shoots stand as `perMetre` and the other fields place them.
		 */
		readonly limbMass?: {
			/** The botanical order at or below which an axis counts as a limb mass's wood. */
			readonly order: number;
			/** Metres from that wood at which the foliage stands at its full density. */
			readonly hold: number;
			/** Metres from that wood at which the foliage has thinned by `depth`. */
			readonly reach: number;
			/** How far the foliage thins at the reach, 0 even and 1 bare. */
			readonly depth: number;
			/**
			 * The share of the full density at or below which a bud bears nothing at all, so the wood
			 * that carried it dies and the bare trim takes it. Absent, a thinned bud keeps the odd
			 * shoot, and that shoot holds its length of wood in the picture.
			 */
			readonly bare?: number;
		};
	};
}

/**
 * One kind of shoot: long, short, spur, whip or spray.
 *
 * @category api/vegetation
 */
export interface ShootClass {
	/** The class's name. */
	readonly name:
		| 'long'
		| 'short'
		| 'spur'
		| 'whip'
		| 'spray'
		| 'cut'
		| 'twig'
		| 'twig-big'
		| 'whip-stem';
	/** Bud vigor this class serves, 0 weak to 1 strong. */
	readonly vigor: readonly [number, number];
	/** Share of the species' prototypes in this class. */
	readonly share: number;
	/** Shoot length in metres. */
	readonly length: Spread;
	/** Nodes per shoot. */
	readonly nodes: Spread;
	/** Internode over shoot length, by position along the shoot. */
	readonly internode: Curve;
	/** Leaf size over the species' leaf length, by position along the shoot. */
	readonly leafScale: Curve;
	/** Degrees between leaf and shoot, by position. */
	readonly leafAngle: Curve;
	/**
	 * Degrees a leaf's angle varies from the curve, one leaf to the next. A rosette crowds its
	 * leaves at the shoot's tip, so without this they all take the curve's last angle and the
	 * cluster stands as one flat cone; with it the leaves open over a range and the cluster reads
	 * round from every side.
	 */
	readonly leafAngleSpread?: number;
	/**
	 * Degrees about the shoot where its first leaf stands, where every shoot of the class must show
	 * its leaf the same way up: a cactus areole's spine cluster lies with its longest spine pointing
	 * down the stem. Absent, each shoot takes a turn of its own from the hash.
	 */
	readonly azimuth?: number;
	/**
	 * Degrees each leaf's azimuth varies from the arrangement's own, from 0 to 90: a two-ranked
	 * shoot's leaves then lie in a shallow cup rather than one plane, so its fan keeps a width as it
	 * turns edge-on.
	 */
	readonly leafAzimuthSpread?: number;
	/** Degrees the shoot hangs over its length (willow whips, birch). */
	readonly droop: number;
	/**
	 * Years of growth in this class's prototypes, 1 to 3: 1 for a current-year shoot alone (an oak's
	 * terminal rosette), more for one with older years below it. The species' `years` by default.
	 */
	readonly years?: number;
	/**
	 * The class's own stem radius in metres at the shoot's base and tip, where it differs from the
	 * species': an old twig is thicker than this year's shoot, and a cutting of it shows that.
	 */
	readonly stem?: { readonly radius: readonly [base: number, tip: number] };
	/**
	 * Whether the shoot draws as its leaves alone, each a cut-out card of two triangles at every
	 * tier, with no stem and no bud: a cactus's spine cluster, whose card carries its pad and spines
	 * in its picture and stands in thousands on one plant.
	 */
	readonly cards?: boolean;
	/**
	 * How this class's leaves or buds stand along its shoots, where the species' arrangement does not
	 * fit: a studio cutting's photograph shows leaves two-ranked along the twig, while the crown's
	 * shoots spiral so they fill from every side. The species' `phyllotaxis` by default.
	 */
	readonly phyllotaxis?: Phyllotaxis;
	/**
	 * Drawn by a cutting kit alone, which holds this class and no card levels; the plant kit leaves
	 * it out. A cut piece is only ever drawn close up, so a dense class spends the cutting kit's cap
	 * rather than the crown's, and the crown's kit does not pay for leaves the crown never draws.
	 */
	readonly cutOnly?: boolean;
	/**
	 * The share of a leaf's turn toward the sky this class takes, from 0 to 1, where the species' own
	 * value does not fit: a cut twig held up to the camera shows its blades face on, while a crown's
	 * leaves turn their faces up to the light. The species' `placement.skyward` by default.
	 */
	readonly skyward?: number;
	/**
	 * Degrees a lateral of this class leans from its parent, where the species' own value does not
	 * fit: a spray's side twigs spread wider than a whip's.
	 */
	readonly lateral?: number;
	/**
	 * The most degrees, from 0 to 180, that a side shoot of any order may leave at from the shoot's
	 * own line. A side shoot that would leave farther, as one that leaves an already leaning side
	 * shoot on its far side does, turns toward the line on its own side until it stands at this
	 * angle, so no twig of the prototype hangs back along the shoot with its leaves turned edge-on.
	 * Absent, each side shoot leaves as its lean and turn give.
	 */
	readonly lateralMost?: number;
	/**
	 * Side shoots at each joint of the class's prototypes, where an older year's growth unit ends, as
	 * a mean and a half-width; each joint draws its own count and rounds it to a whole number from 0
	 * to 3. One axis's side shoots then turn round it by the golden angle from one joint to the next,
	 * so they alternate along the stem rather than all leaving on one side. A cutting whose twigs
	 * leave one at most joints and two at a few takes a mean near 1.3. Absent, the count follows the
	 * species' tip cluster, from 1 to 3 shoots, and each joint's shoots fan round one azimuth.
	 */
	readonly laterals?: Spread;
	/**
	 * The share of a growth unit's length between one side shoot of a joint and the next, from 0 to
	 * 0.45, so a joint's side shoots all leave within its unit. At 0 they all leave the unit's end, a
	 * fan from one point; above it the first leaves the end and each further one this share of the
	 * unit lower down the stem, so the twigs leave one at a time along the stem, as a cutting shows
	 * them. Absent, 0.
	 */
	readonly lateralGap?: number;
	/**
	 * Breaks the class's long internodes into an even number of straight pieces about `length` metres
	 * long, each piece turned `angle` degrees from the one before, back and forth about the
	 * internode's line, so a twig runs stiff and angular between its nodes, as the winter cut branch
	 * shows. The internode ends on its own line, and its reach falls by the cosine of half the angle,
	 * about 4 % at 34 degrees. An internode shorter than two pieces stays one. `length` is at least
	 * 5 mm and `angle` from 0 to 60 degrees. Absent, every internode is one straight piece.
	 */
	readonly bend?: { readonly length: number; readonly angle: number };
	/**
	 * Years of the class's run that carry leaves, counted back from the newest, where the class
	 * differs from the species' own `leafYears`: at 1 only this year's shoots are in leaf, so a
	 * cutting's older wood stands bare between the rosettes at its tips. A whole number from 0 to the
	 * class's years.
	 */
	readonly leafYears?: number;
}

/**
 * What a species' leaves are.
 *
 * @category api/vegetation
 */
export type Foliage =
	| { readonly kind: 'blade'; readonly leaf: LeafShape; readonly compound?: CompoundLeaf }
	| { readonly kind: 'needle'; readonly needle: NeedleShape }
	| {
			readonly kind: 'fascicle';
			readonly needle: NeedleShape;
			readonly sheath: number;
			readonly twist: number;
	  }
	| { readonly kind: 'scale-spray'; readonly spray: ScaleSpray }
	| { readonly kind: 'frond'; readonly optics: LeafOptics }
	| { readonly kind: 'grass-blade'; readonly blade: GrassBlade }
	| { readonly kind: 'thick'; readonly leaf: ThickLeaf }
	| { readonly kind: 'none' };

/**
 * The name of a kind of foliage.
 *
 * @category api/vegetation
 */
export type FoliageKind = Foliage['kind'];

/**
 * A flat leaf: size, outline, shape in space, stalk and optics.
 *
 * @category api/vegetation
 */
export interface LeafShape {
	/** Blade length in metres, base to tip. */
	readonly length: Spread;
	/** The texture's measured contour, or a parametric outline where no texture leaf exists. */
	readonly outline: 'texture' | ParametricOutline;
	/**
	 * The blade's width over its outline's, 1 where absent. Below 1 the mesh narrows across the
	 * midrib and the texture narrows with it, for a species whose leaves are slimmer than its
	 * texture leaf.
	 */
	readonly breadth?: number;
	/** The leaf stalk. */
	readonly petiole: {
		/** Metres long. */
		readonly length: number;
		/** Metres across. */
		readonly radius: number;
		/** 0 round; 1 flat across the blade, so the leaf flutters (aspen). */
		readonly flat: number;
		/** Degrees it droops. */
		readonly droop: number;
	};
	/** Degrees per side of the V along the midrib. */
	readonly fold: number;
	/** Degrees the tip curls down along the length. */
	readonly curl: number;
	/** Degrees the margins roll: positive up, negative under (live oak). */
	readonly crossCurl: number;
	/** Degrees of twist about the midrib over the length. */
	readonly twist: number;
	/** Margin wave: amplitude in metres and waves per side (beech, hosta). */
	readonly wave: readonly [amplitude: number, count: number];
	/** How the leaf looks under light. */
	readonly optics: LeafOptics;
	/**
	 * The spore cases a fern's leaf carries under its lobes: how many stand along the midrib, their
	 * radius in metres, and the spot of the leaf texture they take their colour from, as u and v.
	 * A leaf that names none carries none.
	 */
	readonly sori?: {
		readonly count: number;
		readonly size: number;
		readonly at: readonly [number, number];
	};
}

/**
 * A leaf outline from numbers, for a species with no texture leaf.
 *
 * @category api/vegetation
 */
export interface ParametricOutline {
	/** Half-width over length, by position along the midrib. */
	readonly width: Curve;
	/** The tip's shape. */
	readonly tip: 'acute' | 'acuminate' | 'rounded' | 'notched';
	/** The base's shape. */
	readonly base: 'cuneate' | 'rounded' | 'cordate' | 'oblique';
}

/**
 * A leaf's light as its references show it under flat light: what the eye sees, not shader inputs.
 * The plant shader turns these into the engine's values, so that a front-lit upper face shows
 * exactly `reflectance` and a back-lit leaf shows `transmittance`.
 *
 * @category api/vegetation
 */
export interface LeafOptics {
	/** Linear colour of the upper face. */
	readonly reflectance: Rgb;
	/** Linear colour of the lower face. */
	readonly reflectanceBack: Rgb;
	/** Linear colour of light through the leaf. */
	readonly transmittance: Rgb;
	/** Perceptual roughness of the upper and lower faces. */
	readonly roughness: readonly [upper: number, lower: number];
	/** Felt on the lower face (holm oak, olive), 0 to 1, as a sheen. */
	readonly sheen?: number;
}

/**
 * A leaf of leaflets: pinnate along a rachis, or palmate from one point.
 *
 * @category api/vegetation
 */
export interface CompoundLeaf {
	/** How the leaflets stand. */
	readonly kind: 'pinnate' | 'palmate';
	/** Leaflets per leaf. */
	readonly leaflets: Spread;
	/** Rachis (pinnate) or common petiole (palmate) over leaflet length. */
	readonly rachis: number;
	/** Whether a pinnate leaf ends in one leaflet. */
	readonly terminal: boolean;
	/**
	 * How many tiers below the leaf's own a leaflet meshes, a whole number from 0 to 2; 1 by
	 * default. A leaflet is a fraction of its leaf's size, so a leaf of a dozen leaflets costs
	 * about as much as a dozen whole leaves at the leaf's own cut. At 0 each leaflet is cut as
	 * finely as a whole leaf.
	 */
	readonly leafletStep?: number;
	/**
	 * The share of its drawn stalk that a leaflet keeps, 0 to 1; 1 by default, the stalk the texture
	 * measured. At 0 the leaflet is sessile: its blade begins at the point where it meets the rachis,
	 * so no stalk stands between the two. A texture's stalk band may carry no leaf on one face, and a
	 * leaflet that draws a stalk from it then stands clear of the rachis on that face.
	 */
	readonly leafletStalk?: number;
	/**
	 * Degrees between each leaflet and the rachis, from 30 to 90; the builder's own angle by default.
	 * A wider angle spreads the leaflets, so the leaf's plan reads wider against its length, as a
	 * leaf that has lost its leaflets' stalks reads narrower.
	 */
	readonly angle?: number;
}

/**
 * A needle and how needles stand on a shoot.
 *
 * @category api/vegetation
 */
export interface NeedleShape {
	/** Needle length in metres. */
	readonly length: Spread;
	/** Needle width in metres. */
	readonly width: number;
	/** The needle's cross-section. */
	readonly section: 'rhombic' | 'flat' | 'half-round' | 'awl';
	/** Needles per centimetre of shoot. */
	readonly density: number;
	/** Degrees from the shoot. */
	readonly angle: number;
	/** Flat needles turned into two ranks (Douglas fir, yew), 0 to 1. */
	readonly ranks: number;
	/** How the needle looks under light. */
	readonly optics: LeafOptics;
}

/**
 * Branchlets clothed in scales: cypress, sequoia, juniper sprays.
 *
 * @category api/vegetation
 */
export interface ScaleSpray {
	/** Orders of branchlets in one spray, 1 to 4: 1 for a single cord, as a cypress's shoot carries. */
	readonly orders: number;
	/** Segment length in metres. */
	readonly segment: number;
	/** Branchlet radius in metres. */
	readonly radius: number;
	/** 0 sprays in every plane (Italian cypress), 1 flat sprays. */
	readonly flatten: number;
	/** Share of inner sprays that are dead and brown. */
	readonly dead: number;
	/** How the scales look under light. */
	readonly optics: LeafOptics;
}

/**
 * A grass or sedge blade: a keeled ribbon on an arching curve, of even width or tapering, ending in
 * a blunt hooded tip (meadow grass) or a long fine point (sedge).
 *
 * @category api/vegetation
 */
export interface GrassBlade {
	/** Blade length in metres, collar to tip. */
	readonly length: Spread;
	/** Blade width in metres at its widest. */
	readonly width: number;
	/** Width over the widest, by position along the blade, before the tip closes it. */
	readonly profile: Curve;
	/** How the blade ends: a short blunt boat-shaped hood, or a long fine point. */
	readonly tip: 'hooded' | 'pointed';
	/** Share of the blade's length over which the tip closes. */
	readonly tipLength: number;
	/** Degrees each half rises from the keel. */
	readonly fold: number;
	/** Degrees of twist over the blade. */
	readonly twist: number;
	/** Degrees the blade arches over its length. */
	readonly arch: Spread;
	/** Share of the blade that is dry at the tip. */
	readonly dryTip: number;
	/**
	 * A pale collar where the blade leaves its sheath: its colour in linear reflectance, and the
	 * share of the blade's base it takes. Absent, the collar draws as the leaf.
	 */
	readonly collar?: { readonly colour: Rgb; readonly share: number };
	/**
	 * A ligule: a pale papery flap standing in the V between the blade and its sheath, drawn in
	 * the collar's colour. Its length and width in metres, and the share of blades that carry
	 * one. Absent, no flap draws.
	 */
	readonly ligule?: {
		readonly length: Spread;
		readonly width: number;
		readonly share?: number;
	};
	/** How the blade looks under light. */
	readonly optics: LeafOptics;
}

/**
 * A broad leaf of deep relief on a long channelled stalk: ribs pleated between curved parallel
 * veins that run from the midrib to the tip, a cupped blade with a heart-shaped base: hosta.
 *
 * @category api/vegetation
 */
export interface ThickLeaf {
	/** Blade length in metres, base to tip. */
	readonly length: Spread;
	/** The texture's measured contour, or a parametric outline where no texture leaf exists. */
	readonly outline: 'texture' | ParametricOutline;
	/**
	 * The ribs: veins a side; the pleat's depth over the spacing between two veins; where the
	 * innermost vein leaves the midrib, as a share of the blade's length; and how far each vein
	 * sweeps out before it runs on to the tip, as a share of the length per unit of its rank.
	 */
	readonly ribs: {
		readonly count: number;
		readonly depth: number;
		readonly start: number;
		readonly sweep: number;
	};
	/** Degrees each half rises at its margin from the midrib's plane: a cupped blade. */
	readonly cup: number;
	/** Degrees the tip curls down along the length. */
	readonly curl: number;
	/** Margin wave: amplitude in metres and waves per side. */
	readonly wave: readonly [amplitude: number, count: number];
	/**
	 * The stalk: its radius in metres where it meets the blade, and the share of that radius the
	 * groove on its upper face sinks.
	 */
	readonly stalk: { readonly radius: number; readonly channel: number };
	/** How the leaf looks under light. */
	readonly optics: LeafOptics;
}

/**
 * The bark of a species: zones by height or radius, young bark, and how the figure scales.
 *
 * @category api/vegetation
 */
export interface BarkSpec {
	/** Zones by height or by radius, each one layer of the bark arrays. */
	readonly zones: readonly BarkZone[];
	/** The young-bark layer for thin wood and for the stems of shoot prototypes. */
	readonly young: number;
	/** Below this radius in metres, wood uses the young layer. */
	readonly youngRadius: number;
	/**
	 * Multiplies the young layer's own colour where thin wood draws it, so a species can take the
	 * young bark toward its own photographs. A record that gives none draws the layer as it is.
	 */
	readonly youngTint?: readonly [number, number, number];
	/** Scale of the figure over the texture's own metres, by radius (t = radius / largest radius). */
	readonly girthScale: Curve;
	/** Metres of the deepest furrow, which the nearest level displaces on the trunk and largest limbs. */
	readonly displacement: number;
	/** The collar where a branch joins its parent. */
	readonly collar: {
		/** Swell of a child at its junction over its own radius. */
		readonly swell: number;
		/** Collar length in child radii. */
		readonly length: number;
		/** Dark bark ridge in the upper crotch, 0 to 1. */
		readonly ridge: number;
	};
	/**
	 * The joint where an axis divides into a fork's leaders. `bend` is the least radius of the elbow
	 * by which each leader turns from its parent's line onto its own, in the parent's radii (above 0;
	 * absent, 1.5): a larger one runs the joint out in a longer, gentler curve. A small turn may take
	 * a longer elbow, so the leader clears its parent's end, and no elbow runs past the leader's own
	 * length. `knot` swells the joint over the wood it joins, as a share of the radius at the elbow's
	 * middle that eases to none at either end (from 0 to 1; absent, 0).
	 */
	readonly fork?: { readonly bend?: number; readonly knot?: number };
	/** Moss: how much, how far up, how much more on the north side, and its colour. */
	readonly moss?: {
		readonly amount: number;
		readonly up: number;
		readonly north: number;
		readonly colour: Rgb;
	};
	/**
	 * Lichen: pale rosettes on the crests, from a height towards the top of the plant (unless `to`
	 * gives a higher limit), and its colour.
	 */
	readonly lichen?: {
		readonly amount: number;
		readonly from: number;
		readonly to?: number;
		readonly colour: Rgb;
	};
	/** Eyes where shed branches were (beech, aspen, birch), per metre of stem. */
	readonly scars?: number;
	/** Peeling strips as fin meshes at the nearest level (birch, plane, eucalyptus). */
	readonly peel?: {
		readonly zone: number;
		readonly perSquareMetre: number;
		readonly width: Spread;
		readonly curl: number;
	};
}

/**
 * One bark zone: a layer of the bark textures over a range of height or radius.
 *
 * @category api/vegetation
 */
export interface BarkZone {
	/** The layer of the bark arrays. */
	readonly layer: number;
	/** Whether the range is in height or in radius. */
	readonly by: 'height' | 'radius';
	/** The zone's start in metres. */
	readonly from: number;
	/** The zone's end in metres. */
	readonly to: number;
	/** Metres over which it blends into the next zone. */
	readonly blend: number;
	/**
	 * Linear factor on each channel of the layer's measured colour, from 0; 1 keeps the measured
	 * colour, and absent is 1 on every channel.
	 */
	readonly tint?: Rgb;
	/**
	 * A band on the zone's other axis, so the zone holds only where both bands do: a zone keyed by
	 * radius may take a height band as well, and its cast then stands on a stem's foot without the
	 * wood above it. A zone that holds on both axes wins over one that holds on a single axis.
	 * Absent, the zone holds on its own axis alone.
	 */
	readonly second?: { readonly from: number; readonly to: number; readonly blend: number };
}

/**
 * The stem base: root flare, buttresses, surface roots and flutes.
 *
 * @category api/vegetation
 */
export interface BaseSpec {
	/**
	 * Radius times one plus amount times exp(-h / height), h in metres above the ground. The amount
	 * is from 0 (no flare); the height of fade is in metres from 0.
	 */
	readonly flare: { readonly amount: number; readonly height: number };
	/**
	 * The bole's taper toward the ground, on top of the flare: below `height` metres (above 0) the
	 * radius gains `amount` (from 0) times one minus h / height over the pipe radius, so the bole
	 * widens evenly from that height down to the foot. Absent, the bole keeps its pipe radius down
	 * to the flare.
	 */
	readonly taper?: { readonly amount: number; readonly height: number };
	/**
	 * Buttress lobes round the foot: how many, each one's swell over the radius at the ground (from
	 * 0), how narrow its crest is (above 0; higher is narrower) and its height of fade in metres
	 * (above 0).
	 */
	readonly buttress?: {
		readonly lobes: Spread;
		readonly amount: number;
		readonly sharpness: number;
		readonly height: number;
		/**
		 * How rounded each lobe's crest stands, from 0 to 1. At 0 the swell falls away from the
		 * ground over the height of fade, so the crest thins to an edge at the meadow; at 1 it keeps
		 * its full swell at the ground and eases out by two and a half heights of fade, so the crest
		 * rises from the meadow as a root's rounded flank. Absent, 0.
		 */
		readonly round?: number;
	};
	/** Roots that run along the ground from the lobes, then dive: lengths, radius and dive in metres. */
	readonly roots?: {
		readonly count: Spread;
		readonly length: Spread;
		readonly radius: number;
		readonly dive: number;
		/**
		 * How far each root stands out of the ground where it leaves the stem, as a share of its
		 * girth, from 0 to 1. With it, a root runs as a ridge that sinks into the ground along its
		 * length, slowly at first, while it tapers to half its radius: its top meets the ground at the
		 * root's end, and it then dives out of sight. Absent, a root runs half buried and dives at its
		 * end.
		 */
		readonly ridge?: number;
	};
	/**
	 * Vertical flutes up the stem (yew, old olive): how many, the groove's depth in metres at the
	 * ground (from 0) and the height in metres they fade out by (above 0).
	 */
	readonly flutes?: { readonly count: Spread; readonly depth: number; readonly height: number };
	/**
	 * An old fire scar on the first stem's foot: the strong trees carry one where a ground fire
	 * burned through the bark and the wood closed over it for a century. It cuts a hollow into the
	 * stem between two heights and darkens the bark there, so the scar faces one side of the tree
	 * while healthy bark closes round it. Absent, the foot has no scar.
	 */
	readonly scar?: ScarSpec;
}

/**
 * A fire scar's hollow: a notch out of one side of the foot, charred. The angles run about the
 * first stem from its frame's normal, which for an upright stem is the plant's +X axis, so a page
 * can turn the plant to face the scar.
 *
 * @category api/vegetation
 */
export interface ScarSpec {
	/** Metres above the ground where the scar's foot stands. */
	readonly from: number;
	/** Metres above the ground where the scar's head stands, above `from`. */
	readonly to: number;
	/** Degrees about the stem where the hollow's centre faces. */
	readonly angle: number;
	/** Degrees of the hollow's full angular width. */
	readonly width: number;
	/** Metres the hollow cuts into the stem at its deepest, in the middle of its height. */
	readonly depth: number;
	/** The charred colour, linear from 0 to 1. */
	readonly colour: Rgb;
	/** The share of the charred colour the hollow takes, from 0 to 1; 0.9 by default. */
	readonly shade?: number;
}

/**
 * A kind of extra on the bud sites: cones, fruit, flowers, catkins, thorns and spines.
 *
 * @category api/vegetation
 */
export interface ExtraSpec {
	/** What the extra is. */
	readonly kind:
		| 'cone'
		| 'fruit'
		| 'flower'
		| 'catkin'
		| 'candle'
		| 'spike'
		| 'thorn'
		| 'spine-cluster'
		| 'berry'
		| 'sheath';
	/**
	 * Which bud sites carry it: 'flower' takes the grower's flower sites (a head's spikelets,
	 * florets or hanging spikes), 'stem-tip' the tip of each flowering stem.
	 */
	readonly at:
		| 'shoot-tip'
		| 'node'
		| 'spur'
		| 'old-wood'
		| 'areole'
		| 'crown-top'
		| 'flower'
		| 'stem-tip'
		| 'culm-node';
	/** Share of matching bud sites that carry one. */
	readonly share: number;
	/** How many stand at one site, 1 by default: an oak's acorns share a stalk in ones to threes. */
	readonly count?: Spread;
	/**
	 * How far out along a shoot a `shoot-tip` site stands, as a share of the way to the tip: 1, the
	 * tip itself, by default. A fruit that hangs from the last joint instead of the tip leaves the
	 * twig standing past it, so its stalk meets wood rather than open air.
	 */
	readonly tipShare?: number;
	/** The seasons it shows in. */
	readonly seasons: readonly Season[];
	/** Its shape. */
	readonly shape: ExtraShape;
	/** Its linear colour. */
	readonly colour: Rgb;
	/**
	 * The linear colour, each channel 0 to 1, of a lathe's scaled band and of the stalks that carry
	 * it, such as an acorn's cup and peduncle, where the rest of the shape takes `colour`. A key
	 * takes it for its seed body, so a bunch reads as brown bodies on green wings. The band meets
	 * the body at a sharp edge. Without one, the whole extra takes `colour`.
	 */
	readonly bandColour?: Rgb;
	/**
	 * The roughness of the shape's body and of its band, each 0 (polished) to 1 (matte): a ripe
	 * acorn's nut is glossy and its cup is not. 0.6 for both by default.
	 */
	readonly roughness?: readonly [body: number, band: number];
	/**
	 * The linear colour, each channel 0 to 1, of the stalk that carries a lathe's copies, such as an
	 * acorn's peduncle. A stalk is young wood, so it takes the branch's tone rather than the cup's;
	 * without one it takes `bandColour`, or `colour` where the record names no band.
	 */
	readonly stalkColour?: Rgb;
	/** Degrees it hangs from its site. */
	readonly hang: number;
	/**
	 * Metres this extra stands from its site, in the plant's own axes: a group of fruits hangs from
	 * one twig, and one of them may stand beside the other rather than on top of it. Every part of the
	 * extra moves with it, its stalks included. Absent, it hangs from the site itself, as it always
	 * has.
	 */
	readonly offset?: Vec3;
	/**
	 * A group number, 0 to 15: extras that name the same number draw at the same sites, so the parts
	 * of one fruit hang on one twig. Each part keeps its own `tipShare` and `offset`, so a group sets
	 * its parts in an order along the shoot rather than stacking them on one point. Absent, an extra
	 * picks its own sites, as it always has.
	 */
	readonly group?: number;
}

/**
 * The shape of an extra: a lathe profile, a petal cup, a spine fan or a catkin.
 *
 * @category api/vegetation
 */
export type ExtraShape =
	| {
			readonly lathe: readonly Vec2[];
			/** Faces round the nearest level's lathe, where the level's own count reads as facets. */
			readonly sides?: number;
			/** Rows of scale bumps, one ring a row. */
			readonly scales?: number;
			/** The profile heights, in metres, that carry the scale bumps: a cup or a cone's fertile part. */
			readonly scaled?: readonly [from: number, to: number];
			/**
			 * Metres of one stalk from the site, shared by every copy the site carries: the copies
			 * hang from its end, as an oak's acorns fork from one peduncle.
			 */
			readonly stalk?: number;
			/**
			 * Metres of each copy's own footstalk from the shared stalk's end. A site that gives
			 * one splays its copies on them, so their bodies clear one another: an oak's acorns
			 * stand on short pedicels below the fork.
			 */
			readonly pedicel?: number;
			/**
			 * Faces round the stalk and the footstalks at the nearest level, where a close view reads
			 * a thin stem's facets: a whole number from 4 to 16. The farther levels draw four, and so
			 * does the nearest when the shape names none.
			 */
			readonly stalkSides?: number;
			/**
			 * How far the crevices between a cup's scales take the body's colour, 0 to 1, on a lathe
			 * whose record gives a band colour: every other vertex round each of the band's rings,
			 * offset from ring to ring, mixes that share toward the body, so the cup reads as rows of
			 * overlapping scales. 0 by default, an even band.
			 */
			readonly scaleShade?: number;
			/**
			 * How much each scale's shade departs from its neighbours', 0 to 1, as a share of the
			 * band's colour: a real cup's scales differ one from the next, where an even band reads as
			 * one flat cone. The departure is fixed for each scale, so the picture repeats. 0 by
			 * default, every scale the same shade.
			 */
			readonly scaleJitter?: number;
			/**
			 * A bed of thin bristles over the lathe's scaled band: rows along it and spikes round each
			 * row, each a short three-sided cone standing along the surface's own normal. A beech's
			 * cupule is a burr of soft spines, where a scale shade alone engraves the husk.
			 */
			readonly bristles?: {
				/** Rows of bristles along the scaled band, 1 to 16. */
				readonly rows: number;
				/** Bristles round each row, 3 to 32. */
				readonly sides: number;
				/** The longest bristle in metres, 0.001 to 0.03. */
				readonly length: number;
			};
	  }
	| {
			/**
			 * A one-winged key (ash, sycamore, elm): a seed body at the site with a flat wing
			 * running from it, drawn as a closed lens so it reads from both faces. A bunch of
			 * them hangs from one stalk.
			 */
			readonly samara: {
				/** Metres from the seed body's top to the wing's tip. */
				readonly length: number;
				/** Metres across the wing at its widest. */
				readonly width: number;
				/** Share of the length that the seed body takes, from 0.1 to 0.6. */
				readonly body: number;
				/**
				 * Degrees the wing's face turns about the key's own length, 0 to 180. 0 by
				 * default, every key in a bunch showing the same face.
				 */
				readonly twist?: number;
			};
			/**
			 * Metres of one stalk from the site, shared by every copy the site carries: the
			 * copies hang from its end, as an oak's acorns fork from one peduncle.
			 */
			readonly stalk?: number;
			/**
			 * Metres of each copy's own footstalk from the shared stalk's end. A site that gives
			 * one splays its copies on them, so their bodies clear one another.
			 */
			readonly pedicel?: number;
			/**
			 * Faces round the stalk and the footstalks at the nearest level, where a close view
			 * reads a thin stem's facets: a whole number from 4 to 16.
			 */
			readonly stalkSides?: number;
	  }
	| {
			readonly petals: number;
			readonly radius: number;
			readonly cup: number;
			/**
			 * Metres of stalk that holds the cup out from its site along the shoot's own direction.
			 * The stalk draws at the nearest level only, where a thin stem reads; absent, the cup
			 * stands at its site as before.
			 */
			readonly stalk?: number;
	  }
	| { readonly spines: number; readonly length: number; readonly spread: number }
	| {
			readonly catkin: {
				readonly length: number;
				readonly radius: number;
				/**
				 * Rows of short spikelets that stand along the body, so a spike reads as a
				 * cluster of them rather than one smooth pendant. Absent, the body is smooth.
				 */
				readonly spikelets?: {
					/** Rows along the body, 2 to 16. */
					readonly count: number;
					/** Share of the body's radius each row adds, from 0 to 1; absent, 0.35. */
					readonly bulge?: number;
				};
			};
	  };

/**
 * The seasons a species shows.
 *
 * @category api/vegetation
 */
export interface SeasonSpec {
	/** The season a plant grows for when a page names none. */
	readonly default: Season;
	/** Whether the species drops its leaves. */
	readonly deciduous: boolean;
	/** Winter foliage: bare, dead brown leaves kept (young beech), or evergreen. */
	readonly winter: 'bare' | 'marcescent' | 'evergreen';
	/** Autumn leaf colours. */
	readonly autumn?: { readonly reflectance: Rgb; readonly transmittance: Rgb };
	/** Blossom: which extra flowers, and the share of leaves that are out. */
	readonly blossom?: { readonly extra: number; readonly leaves: number };
	/**
	 * A linear colour each named season multiplies into the bark, for a stem whose own colour turns
	 * with the year. A season left out keeps the record's own bark.
	 */
	readonly bark?: Partial<Record<Season, Rgb>>;
	/**
	 * The leaves' linear reflectance and transmittance in a season, in place of the autumn colours
	 * that a turning plant draws its dead leaves with. A season left out keeps the autumn colours,
	 * and the autumn block holds autumn's own.
	 */
	readonly leaves?: Partial<
		Record<Season, { readonly reflectance: Rgb; readonly transmittance: Rgb }>
	>;
}

/**
 * How a species moves in the wind.
 *
 * @category api/vegetation
 */
export interface WindSpec {
	/** Stiffness by order (t = order / deepest order), 0 free to 1 rigid. */
	readonly stiffness: Curve;
	/**
	 * The whole plant's sway: cycles a second, and metres at the top in the field's base wind
	 * speed. A species that names none takes the stated default, so a missing sway never leaves
	 * the plant still.
	 */
	readonly sway?: {
		readonly frequency: number;
		readonly amplitude: number;
		/**
		 * How sharply the sway grows up a stem: its share of the top's motion is the distance along
		 * the stem raised to this power. The cantilever's square, 2, is the default; a stiffer stem
		 * takes a higher power, so its lower length stays put while its top moves. From 1 to 6.
		 */
		readonly power?: number;
	};
	/** Orders from which shoots swing as hanging chains (willow, birch). */
	readonly whips?: { readonly fromOrder: number; readonly pendulum: number };
	/** How leaves flutter. */
	readonly flutter: {
		readonly kind: 'blade' | 'flat-petiole' | 'needle' | 'leaflet' | 'grass';
		readonly amplitude: number;
		readonly frequency: number;
		/**
		 * The share of `amplitude` at a height up the plant, from 0 at the ground to 1 at the top. A
		 * beech's open low skirt swings in the wind while its dense crown's top stays still, which one
		 * amplitude cannot say; a curve lets the low sprays move more than the top. Absent, every
		 * height takes the whole amplitude, so a species that names no curve moves as it did.
		 */
		readonly byHeight?: Curve;
	};
}

/**
 * A species' detail levels, and its own budget.
 *
 * @category api/vegetation
 */
export interface LodSpec {
	/** The nearest level's foliage: shoot prototypes as rows per copy, or merged into the variant's mesh. */
	readonly nearFoliage: 'instanced' | 'merged';
	/**
	 * Screen pixels at each switch: a shoot's length at the first switch, a shoot card's at the
	 * second, the plant's height at the switch to the impostor.
	 */
	readonly switchPixels: readonly [lod1: number, lod2: number, lod3: number];
	/** Macro orders that the first and second card levels keep as wood. */
	readonly woodOrders: readonly [lod1: number, lod2: number];
	/**
	 * Texels a side of one cell of the card atlas, at each tier, where the default cell does not
	 * suit the species: each entry is a power of two from 32 to 256, and 64 by default. A needle a millimetre and a half across is under one texel
	 * of a 64 cell, so its card would draw only the bare twig; a cell of 128 holds it while the
	 * crown still reads green. A piece whose card first shows at two dozen pixels is held by a
	 * cell of 32. Each doubling costs four times the atlas memory.
	 */
	readonly cardCell?: Readonly<Record<Detail, number>>;
	/**
	 * Whether a prototype many times longer than wide is cut along its line into cards of its own:
	 * `most` stretches at most, from 1 to 8, and 1 by default, which cuts nothing; and `cells`,
	 * whether each stretch's planes take a whole cell or a half one, `half` by default. Each stretch
	 * draws planes of its own, so a cut card costs more triangles at every card level and more atlas,
	 * and a species asks for it only where its pictures read better and its caps hold the cost. A
	 * half cell keeps the atlas near its uncut size and still gives a blade or a strand more texels
	 * along its length; a wide frond whose leaflets need the texels across takes whole cells.
	 */
	readonly cardCuts?: { readonly most?: number; readonly cells?: 'full' | 'half' };
	/**
	 * Whether a card draws the twig it stands on, from 0 to 8. A card stands on its axis's twig,
	 * whose wood may be thinner than a pixel at a whole view, so the card's leaves read as a piece
	 * in air where the twig does not draw. At 1 or more the card draws its supporting twig as a
	 * line in the young bark's tone, as wide as that twig on screen and never under the wood's least
	 * drawn width, so the join shows at any distance. 0 or absent, a card draws no stalk.
	 */
	readonly cardStalk?: number;
	/**
	 * Whether a card's stalk runs on past the row to the centre of the foliage the card carries. A
	 * card's plane stands ahead of the row that draws it by the shoot's own length, so the stretch
	 * behind the row may end half a metre short of the leaves it is meant to carry. With this, the
	 * line starts at the parent node's end and ends at the card plane's centre, so the card meets the
	 * wood it grows from. Absent, the line spans only the stretch behind the row, as it always has.
	 */
	readonly cardStalkToFoliage?: boolean;
	/** The impostor's views across and texels per view. */
	readonly impostor: { readonly views: number; readonly texels: number };
	/** The level that casts shadows. */
	readonly shadowLevel: number;
	/** This species' own limits. */
	readonly budget: SpeciesBudget;
}

/**
 * This species' own limits, under the owner's caps for its growth model.
 *
 * @category api/vegetation
 */
export interface SpeciesBudget {
	/**
	 * Bytes of the kit at each detail tier, the tier it is built for: the shoot prototypes' meshes at
	 * that tier and those below it, the leaf meshes, and the card atlas until it uploads.
	 */
	readonly kitBytes: Readonly<Record<Detail, number>>;
	/**
	 * Bytes of one variant at each detail tier, read at the tier the plant is built for: its levels
	 * and wind records, the nearest wood left out.
	 */
	readonly variantBytes: Readonly<Record<Detail, number>>;
	/** Triangles of the nearest level of one copy, at the high tier. */
	readonly lod0Triangles: number;
	/** Triangles of the first card level. */
	readonly lod1Triangles: number;
	/** Triangles of the second card level. */
	readonly lod2Triangles: number;
	/** Bytes a page downloads for this species: its chunk and its full texture set. */
	readonly downloadBytes: number;
	/** The same with the half texture set, which the Low preset fetches. */
	readonly downloadHalfBytes: number;
	/** Milliseconds to grow one variant in Bun on the reference Mac. */
	readonly growMilliseconds: number;
}

/**
 * Which pieces a close review cuts from a plant.
 *
 * @category api/vegetation
 */
export interface CuttingHints {
	/**
	 * The leaves that one shoot of a piece carries, where a plant's pieces are shoots of its crown
	 * rather than shoot prototypes: a rosette cuts an eye of the grown plant, so the crown's own
	 * leaf count would give the piece the whole crown's density. A class of its own cannot serve
	 * these plants, whose leaves carry no prototypes to place. Absent, a piece takes the crown's
	 * leaf count, as it did before this field.
	 */
	readonly leaves?: Spread;
	/**
	 * The shoots a cutting kit places over the crown's own, from 0.25 to 8, where a piece cut for
	 * close review carries a denser covering than the crown can afford. The crown's kit is unchanged:
	 * the piece is drawn at the nearest level alone, so its kit pays for no card levels. A piece's
	 * own hint may give a density of its own in place of this one.
	 */
	readonly density?: number;
	/**
	 * A branch about 1 m long: the macro order to cut from the grown plant and the length of its
	 * wood, or the shoot class whose prototype stands for it.
	 */
	readonly branch?: CutFromPlant | CutFromShoots;
	/** A sub-branch about 0.35 m long, in either form. */
	readonly subbranch?: CutFromPlant | CutFromShoots;
	/** A leaf cluster: the shoot class to cut, or a length of a frond's rachis. */
	readonly cluster?: CutFromPlant | CutFromShoots;
	/** A single leaf: how it lies. */
	readonly leaf?: CutLeaf;
}

/**
 * How a single leaf cut from the plant lies.
 *
 * @category api/vegetation
 */
export interface CutLeaf {
	/**
	 * Whether the leaf lies pressed flat, as a species' single-leaf pictures lay it on a copy stand:
	 * a blade leaf's fold, curls, twist, wave and stalk droop at nothing, a thick leaf's cup, curl
	 * and margin wave at nothing, and a frond's droop, twist and pinnae fold at nothing too, so its
	 * rachis runs straight on from the stipe. Its outline and textures are as they are. Without it
	 * the leaf keeps the shape it has on the plant.
	 */
	readonly pressed?: boolean;
	/**
	 * Metres of blade the piece draws, where the pictures show a young blade shorter than the
	 * record's: the blade's width and profile are unchanged, so the piece takes the young blade's
	 * proportions. Absent, the record's length.
	 */
	readonly length?: number;
	/**
	 * Metres of stalk a pressed leaf keeps under its blade, for a species whose leaves rise on long
	 * stalks: the piece shows the short piece of stalk a picked leaf does. A share of the blade's
	 * length by default.
	 */
	readonly petiole?: number;
}

/**
 * A piece cut from the grown plant: the macro order of the axis it starts from, and the metres of
 * wood from the cut to the farthest tip.
 *
 * @category api/vegetation
 */
export interface CutFromPlant {
	/** The macro order to cut. */
	readonly order: number;
	/** Metres of wood from the cut to the farthest tip. */
	readonly length: number;
	/**
	 * How the piece's photograph stands it: `as-grown` keeps the turn it grew with, as a saguaro's
	 * arm stands on its elbow with its upright part plumb. Where it names none, the piece stands as
	 * the cutting asks, upright on the line from its cut.
	 */
	readonly stands?: 'as-grown';
	/**
	 * The shoots this piece places over the crown's own, from 0.25 to 8: a density of its own, where
	 * the piece covers more or less than the species' `cuttings.density`, which applies where it
	 * names none. A piece cut from the grown plant takes the kit this reshapes.
	 */
	readonly density?: number;
	/**
	 * Metres of the axis that the piece keeps from its cut, for a plant whose pieces are lengths of
	 * a single long axis, such as a palm's frond. Without it the piece keeps the whole axis.
	 */
	readonly span?: number;
	/**
	 * Metres along the axis where the piece starts, for a piece cut from the middle of one long
	 * axis rather than its base. The cut face stands there. 0 by default.
	 */
	readonly from?: number;
	/**
	 * The piece's leaf size over the crown's, where a piece cut from the plant wants leaves of its
	 * own. A rosette's piece carries the crown's leaves at the crown's size, so a piece that stands
	 * a little too dense for its photograph is opened by shrinking its leaves rather than by taking
	 * a whole leaf from it. 1 by default.
	 */
	readonly scale?: number;
}

/**
 * A piece taken from the kit: one shoot prototype of a class, for a species whose shoots carry the
 * piece's twigs, as an oak's two-year twig is its sub-branch.
 *
 * @category api/vegetation
 */
export interface CutFromShoots {
	/** The shoot class to take. */
	readonly shoot: ShootClass['name'];
	/**
	 * Which of that class's prototypes to take, 0 for the first: two pieces may want shoots of one
	 * class and still be different pieces, as a sub-branch and a leaf cluster are.
	 */
	readonly pick?: number;
	/**
	 * A density here does nothing: a piece taken from a shoot prototype carries the prototype's own
	 * covering, and only a piece cut from the grown plant has placement to reshape. Thin a shoot-cut
	 * piece with a class of its own instead, or leave the field out.
	 */
	readonly density?: number;
	/**
	 * How many shoots the piece carries, fanned about its own upright axis, where a branch photograph
	 * shows a divided, hanging branch: one shoot is a class prototype, and a branch needs more. 1 by
	 * default, and a cluster or a leaf keeps one whatever it names.
	 */
	readonly shoots?: number;
	/**
	 * The radius of the ring the fanned shoots stand on, as a share of the piece's height. A small
	 * ring joins the shoots at the base; a wide one spreads them. Applies only where `shoots` names
	 * more than one. 0.18 by default.
	 */
	readonly fanRing?: number;
	/**
	 * The degrees each fanned shoot leans outward from the piece's upright axis, so the shoots share
	 * a base and diverge above it. Negative values lean them inward. 0 by default.
	 */
	readonly fanLean?: number;
	/**
	 * The share of a full turn each fanned shoot takes about the piece's axis, from 0 for every
	 * shoot keeping the prototype's own leaf plane to 1 for an even fan. 1 by default.
	 */
	readonly fanSpin?: number;
	/**
	 * The degrees the whole piece turns about its upright axis before it is framed. A branch whose
	 * side shoots lie in one plane shows that plane from the camera the pieces are drawn from, so a
	 * species whose photograph lays the branch across the frame turns it by a quarter. 0 by default.
	 */
	readonly fanYaw?: number;
	/**
	 * How the fanned shoots are placed: round a ring about the axis, along one lateral spray, or
	 * across the prototype's own leaf plane from one shared base. A fan keeps every row's leaf faces
	 * turned alike, so a species whose leaves are two-ranked can spread the piece and still show its
	 * blades. 'ring' by default.
	 */
	readonly layout?: 'ring' | 'spray' | 'fan';
	/**
	 * The width a spray or fan spans, as a share of the piece's height. 0 by default.
	 */
	readonly spread?: number;
	/**
	 * The shoot class of the piece's main stem. Naming it builds the stem-and-laterals assembly: the
	 * stem stands upright on its cut and full hanging shoots of the hint's own class join it at
	 * heights along it, so a photograph of a branch with hanging side shoots draws as one joined
	 * piece. Absent, the piece keeps the one class and its fan.
	 */
	readonly stem?: ShootClass['name'];
	/**
	 * How many lateral shoots hang from the stem, from 1 to the cutting's most. 6 by default.
	 */
	readonly laterals?: number;
	/**
	 * The share of the stem's height where the first lateral leaves, from 0 at the stem's foot to 1
	 * at its tip. 0.45 by default.
	 */
	readonly lateralFrom?: number;
	/**
	 * The share of the stem's height where the last lateral leaves, from 0 at the stem's foot to 1
	 * at its tip. 0.92 by default.
	 */
	readonly lateralTo?: number;
	/**
	 * Degrees each lateral leans outward from the stem's line, so a positive value opens the hanging
	 * shoots away from the stem. 20 by default.
	 */
	readonly lateralAngle?: number;
	/**
	 * The laterals' length over their class's, so one stem class serves a long branch and a short
	 * twig: 0.5 hangs half-length shoots, 1.5 hangs longer ones. 1 by default.
	 */
	readonly lateralScale?: number;
	/**
	 * Which of the stem class's prototypes to take, 0 for the first. 0 by default.
	 */
	readonly stemPick?: number;
}

/**
 * What a species folder's `index.ts` exports as `species`: the record and the texture files.
 *
 * @category api/vegetation
 */
export interface SpeciesModule {
	/** The species record. */
	readonly record: Species;
	/** The texture files of both sets, and their manifest. */
	readonly textures: SpeciesTextureFiles;
}

/**
 * What a species folder's optional `hooks.ts` may add: shape code that no growth model's numbers can
 * express. Only the job worker imports it.
 *
 * @category api/vegetation
 */
export interface SpeciesHooks {
	/** Changes the grown skeleton before the shoots attach, such as the banyan's fused trunk. */
	readonly afterGrow?: (skeleton: MacroSkeleton, record: Species, seed: number) => void;
	/** Changes one shoot prototype after it is built. */
	readonly shoot?: (prototype: ShootPrototype, record: Species) => void;
}
