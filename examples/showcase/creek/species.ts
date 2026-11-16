// The Creek valley's species: their ids, sizes, colours and how the valley's rules treat them.
// The table is plain data so a tool can build each species' stand-in from the same numbers the
// page grows it with.
/** The seed that places the valley, so a build gives the same plants on every device. */
export const SEED = 7;
/** The variants that Creek grows of each species. The copies' own sizes and turns carry the rest. */
export const VARIANTS = 4;

/** One species that dresses the valley: its id in the add-on's catalogue and its stand-in's look. */
export interface CreekSpecies {
	/** The species' id, which the rules place by. */
	readonly id: string;
	/** Height of a grown plant at scale 1, in meters. */
	readonly height: number;
	/** The reach of its crown about its trunk at scale 1, in meters, which the rules space it by. */
	readonly crown: number;
	/** Linear colour of its leaves and of its bark. */
	readonly leaf: readonly [number, number, number];
	readonly bark: readonly [number, number, number];
	/** True for a tree of the canopy, which hands over to far cards. */
	readonly canopy: boolean;
}

/**
 * The species that the valley's rules place. Each draws as the plant core's stand-in, at its size
 * and in its colours, until its species lands in the add-on.
 */
export const SPECIES: readonly CreekSpecies[] = [
	{
		id: 'pedunculate-oak',
		height: 13,
		crown: 5.7,
		leaf: [0.09, 0.19, 0.045],
		bark: [0.18, 0.15, 0.12],
		canopy: true,
	},
	{
		id: 'european-beech',
		height: 14,
		crown: 6,
		leaf: [0.14, 0.28, 0.07],
		bark: [0.32, 0.3, 0.27],
		canopy: true,
	},
	{
		id: 'silver-birch',
		height: 12,
		crown: 5.5,
		leaf: [0.2, 0.34, 0.1],
		bark: [0.62, 0.6, 0.55],
		canopy: true,
	},
	{
		id: 'weeping-willow',
		height: 10,
		crown: 4.42,
		leaf: [0.18, 0.3, 0.1],
		bark: [0.25, 0.21, 0.15],
		canopy: true,
	},
	{
		id: 'common-alder',
		height: 9.5,
		crown: 4.1,
		leaf: [0.16, 0.3, 0.09],
		bark: [0.22, 0.2, 0.17],
		canopy: true,
	},
	{
		id: 'norway-spruce',
		height: 15,
		crown: 7.1,
		leaf: [0.08, 0.2, 0.09],
		bark: [0.26, 0.18, 0.13],
		canopy: true,
	},
	{
		id: 'hosta',
		height: 0.6,
		crown: 0.44,
		leaf: [0.12, 0.3, 0.09],
		bark: [0.2, 0.18, 0.12],
		canopy: false,
	},
	{
		id: 'sedge',
		height: 0.85,
		crown: 0.64,
		leaf: [0.2, 0.32, 0.1],
		bark: [0.22, 0.2, 0.12],
		canopy: false,
	},
	{
		id: 'rush',
		height: 1.15,
		crown: 0.88,
		leaf: [0.16, 0.3, 0.09],
		bark: [0.2, 0.19, 0.13],
		canopy: false,
	},
	{
		id: 'wildflower',
		height: 0.4,
		crown: 0.272,
		leaf: [0.14, 0.3, 0.08],
		bark: [0.2, 0.18, 0.12],
		canopy: false,
	},
	{
		id: 'hawthorn-shrub',
		height: 2.4,
		crown: 1.16,
		leaf: [0.15, 0.3, 0.1],
		bark: [0.22, 0.18, 0.13],
		canopy: false,
	},
	{
		id: 'bracken',
		height: 0.9,
		crown: 0.72,
		leaf: [0.11, 0.26, 0.06],
		bark: [0.2, 0.16, 0.1],
		canopy: false,
	},
];
