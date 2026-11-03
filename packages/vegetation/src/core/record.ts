// The species record and every part of it: what one species is, as plain data. A record names its
// growth model and that model's numbers, the outline the plant fills, its shoots and leaves, its
// bark, its extras, its seasons, its wind and its detail levels with its own budget. Nothing here
// runs: the growers, the leaf builders and the meshers read these numbers.

import type { ShootPrototype } from '../asset';
import type { EcoRule } from '../ecology/ecology';
import type { MacroSkeleton } from './graph';
import type { SpeciesTextureFiles } from './textures';
import type { Curve, Detail, Rgb, Season, Spread, Vec2, Vec3 } from './types';

/**
 * One species: the folder of its own under `species/`, grown by one of the eight growth models.
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
	/** The plant's size. */
	readonly size: PlantSize;
	/** How the large structure grows: the model and its numbers. */
	readonly growth: Growth;
	/** The outline the plant fills. Required for 'self-organizing'; a cap for the other models. */
	readonly envelope?: Envelope;
	/** The shoot prototypes that carry the finest orders, buds and leaves. */
	readonly shoots?: ShootSpec;
	/** What the leaves are. */
	readonly foliage: Foliage;
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
 * How the large structure of a plant grows: one of eight models, each with its own numbers.
 *
 * @category api/vegetation
 */
export type Growth =
	| SelfOrganizing
	| Architectural
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
	};
	/** Sag under the subtree's load, then the tip's upturn (reaction wood). */
	readonly bending: { readonly strength: number; readonly upturn: number };
	/** Pipe model: a parent's diameter to the exponent is the sum of its children's, and a terminal twig's radius in metres. */
	readonly pipe: { readonly exponent: number; readonly tipRadius: number };
	/** A bottle, a twist or a gnarl in the stem. */
	readonly trunk?: TrunkShape;
	/** Roots that drop from the limbs and become pillars (banyan). */
	readonly aerialRoots?: AerialRoots;
	/** Clipping to a shape: hedges and topiary. */
	readonly clip?: Clip;
}

/**
 * The stems of a self-organizing plant: one, or a stool of several.
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
		/** Dead fronds: count, how far they hang, and a skirt that hides the stem top (fan palm). */
		readonly dead: { readonly count: Spread; readonly hang: number; readonly skirt: number };
		/** Young fronds rolled in the centre (tree fern croziers). */
		readonly croziers?: Spread;
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
	/** The buried rhizome: metres long, branches, and metres between fronds. */
	readonly rhizome: {
		readonly length: number;
		readonly branches: Spread;
		readonly spacing: Spread;
	};
	/** Stipe height and lean; the blade is held near horizontal on top. */
	readonly stipe: { readonly length: Spread; readonly lean: Spread };
	/** One frond. */
	readonly frond: FrondShape;
	/** Young fronds still rolled. */
	readonly croziers: Spread;
}

/**
 * A tuft of shoots from one crown, each shoot a column of sheaths with blades in two or three ranks,
 * and flowering stems in season: grasses and sedges.
 *
 * @category api/vegetation
 */
export interface Tuft {
	/** The model's name. */
	readonly model: 'tuft';
	/** Shoots (tillers) per tuft. */
	readonly shoots: Spread;
	/** Radius of the crown the shoots rise from, in metres. */
	readonly base: number;
	/** Degrees a shoot leans out from vertical, by its distance from the centre (t = distance / base). */
	readonly lean: Curve;
	/** Blades per shoot. */
	readonly blades: Spread;
	/** Ranks the blades stand in round their shoot: 2 for grasses, 3 for sedges. */
	readonly ranks: number;
	/** Metres of sheath under each blade's collar. */
	readonly sheath: Spread;
	/** The sheath's radius in metres. */
	readonly sheathRadius: number;
	/** Degrees a blade leaves its shoot, by blade age (t = 0 the youngest, innermost, 1 the oldest). */
	readonly spread: Curve;
	/** Blade length over the foliage's blade length, by blade age. */
	readonly size: Curve;
	/** Flowering stems: how many, how tall, how they bow, and their heads. */
	readonly heads?: TuftHeads;
}

/**
 * The flowering stems of a tuft and the heads they carry. Each head's flowers or spikes are the
 * record's extras on the stem's flower sites ('flower') and its tip ('stem-tip').
 *
 * @category api/vegetation
 */
export interface TuftHeads {
	/** Flowering stems per tuft. */
	readonly count: Spread;
	/** What the heads are: an open branched panicle (grasses) or spikes hanging on stalks (sedges). */
	readonly kind: 'panicle' | 'spike';
	/** Stem height in metres. */
	readonly height: Spread;
	/** The stem's radius at its base in metres. */
	readonly radius: number;
	/** Faces round the stem: 3 for a sedge's three-angled stem, more for a round culm. */
	readonly sides: number;
	/** Degrees the stem's top bows over from vertical. */
	readonly bow: Spread;
	/** The seasons the stems stand in. */
	readonly seasons: readonly Season[];
	/** A panicle: its length, whorls of branches, and flowers along each branch. */
	readonly panicle?: {
		/** Metres of the stem's top that the panicle takes. */
		readonly length: Spread;
		/** Whorls of branches up the panicle. */
		readonly whorls: number;
		/** Branches per whorl. */
		readonly branches: Spread;
		/** Degrees a branch leaves the stem, low whorls to high (t = 0 lowest, 1 highest). */
		readonly angle: Curve;
		/** Degrees a branch droops over its length. */
		readonly droop: number;
		/** Flowers (spikelets) per branch, on its outer part. */
		readonly flowers: Spread;
	};
	/** Spikes hanging one below another from the stem's bowed top. */
	readonly spikes?: {
		/** Spikes per stem below the one at its tip. */
		readonly count: Spread;
		/** Metres between spikes along the stem. */
		readonly spacing: Spread;
		/** Metres of the stalk each spike hangs on. */
		readonly stalk: Spread;
	};
}

/**
 * A ribbed column with arms: saguaro.
 *
 * @category api/vegetation
 */
export interface Column {
	/** The model's name. */
	readonly model: 'column';
	/** Height in metres. */
	readonly height: Spread;
	/** Radius in metres by height (t = height / plant height). */
	readonly radius: Curve;
	/** Ribs around the column. */
	readonly ribs: Spread;
	/** Rib depth in metres. */
	readonly ribDepth: number;
	/** The arms. */
	readonly arms: {
		/** Arms per plant. */
		readonly count: Spread;
		/** Share of height where arms leave. */
		readonly from: number;
		/** Metres out from the column where an arm turns upward. */
		readonly elbow: number;
		/** An arm's radius in metres. */
		readonly radius: number;
		/** Metres an arm rises after its elbow. */
		readonly rise: Spread;
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
 * @category api/vegetation
 */
export type Phyllotaxis =
	| { readonly kind: 'spiral'; readonly divergence: number }
	| { readonly kind: 'distichous'; readonly flatten: number }
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
	/** Leaf or needle arrangement along a shoot. */
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
	};
	/** Where shoots attach to a variant. */
	readonly placement: {
		/** Shoots per metre of the finest macro axes, by bud vigor (t = vigor). */
		readonly perMetre: Curve;
		/** No shoot where sky visibility is below this: shade pruning. */
		readonly shadePrune: number;
		/** How far a shoot turns its leaves toward the sky, 0 to 1 (flat beech sprays). */
		readonly skyward: number;
		/** A shoot's scale. */
		readonly scale: Spread;
	};
}

/**
 * One kind of shoot: long, short, spur, whip or spray.
 *
 * @category api/vegetation
 */
export interface ShootClass {
	/** The class's name. */
	readonly name: 'long' | 'short' | 'spur' | 'whip' | 'spray';
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
	/** Degrees the shoot hangs over its length (willow whips, birch). */
	readonly droop: number;
	/**
	 * Years of growth in this class's prototypes, 1 to 3: 1 for a current-year shoot alone (an oak's
	 * terminal rosette), more for one with older years below it. The species' `years` by default.
	 */
	readonly years?: number;
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
	/** Orders of branchlets in one spray, 2 to 4. */
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
	/** Moss: how much, how far up, how much more on the north side, and its colour. */
	readonly moss?: {
		readonly amount: number;
		readonly up: number;
		readonly north: number;
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
	/** Linear tint on the layer's measured colour. */
	readonly tint?: Rgb;
}

/**
 * The stem base: root flare, buttresses, surface roots and flutes.
 *
 * @category api/vegetation
 */
export interface BaseSpec {
	/** Radius times one plus amount times exp(-h / height), h in metres above the ground. */
	readonly flare: { readonly amount: number; readonly height: number };
	/** Buttress lobes: count, amount, sharpness and height in metres. */
	readonly buttress?: {
		readonly lobes: Spread;
		readonly amount: number;
		readonly sharpness: number;
		readonly height: number;
	};
	/** Roots that run along the ground from the lobes, then dive. */
	readonly roots?: {
		readonly count: Spread;
		readonly length: Spread;
		readonly radius: number;
		readonly dive: number;
	};
	/** Vertical flutes up the stem (yew, old olive). */
	readonly flutes?: { readonly count: Spread; readonly depth: number; readonly height: number };
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
		| 'berry';
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
		| 'stem-tip';
	/** Share of matching bud sites that carry one. */
	readonly share: number;
	/** The seasons it shows in. */
	readonly seasons: readonly Season[];
	/** Its shape. */
	readonly shape: ExtraShape;
	/** Its linear colour. */
	readonly colour: Rgb;
	/** Degrees it hangs from its site. */
	readonly hang: number;
}

/**
 * The shape of an extra: a lathe profile, a petal cup, a spine fan or a catkin.
 *
 * @category api/vegetation
 */
export type ExtraShape =
	| { readonly lathe: readonly Vec2[]; readonly scales?: number }
	| { readonly petals: number; readonly radius: number; readonly cup: number }
	| { readonly spines: number; readonly length: number; readonly spread: number }
	| { readonly catkin: { readonly length: number; readonly radius: number } };

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
}

/**
 * How a species moves in the wind.
 *
 * @category api/vegetation
 */
export interface WindSpec {
	/** Stiffness by order (t = order / deepest order), 0 free to 1 rigid. */
	readonly stiffness: Curve;
	/** The whole plant's sway: cycles a second and metres at the top. */
	readonly sway: { readonly frequency: number; readonly amplitude: number };
	/** Orders from which shoots swing as hanging chains (willow, birch). */
	readonly whips?: { readonly fromOrder: number; readonly pendulum: number };
	/** How leaves flutter. */
	readonly flutter: {
		readonly kind: 'blade' | 'flat-petiole' | 'needle' | 'leaflet' | 'grass';
		readonly amplitude: number;
		readonly frequency: number;
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
	/** Bytes of the kit: prototypes in every tier, and the card atlas until it uploads. */
	readonly kitBytes: number;
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
	/** A branch about 1 m long: the macro order to cut and its length. */
	readonly branch?: { readonly order: number; readonly length: number };
	/** A sub-branch about 0.35 m long. */
	readonly subbranch?: { readonly order: number; readonly length: number };
	/** A leaf cluster: the shoot class to cut. */
	readonly cluster?: { readonly shoot: ShootClass['name'] };
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
