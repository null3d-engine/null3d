// The periodic table of three.js's CSS3D example (examples/css3d_periodictable.html, r186), as
// plain data and layout that the null3D port and its three.js twin share. The example gives each
// cell a random tint; the port takes a fixed tint from the cell's place, so a held picture shows
// the same colors in both engines.

/** One cell's facts, in the example's order: its symbol, name, atomic mass, group and period. */
export interface ElementCell {
	readonly symbol: string;
	readonly name: string;
	readonly mass: string;
	readonly group: number;
	readonly period: number;
}

/** Every cell of the table, row by row from hydrogen, as three.js's example lists them. */
export const ELEMENTS: readonly ElementCell[] = [
	{ symbol: 'H', name: 'Hydrogen', mass: '1.00794', group: 1, period: 1 },
	{ symbol: 'He', name: 'Helium', mass: '4.002602', group: 18, period: 1 },
	{ symbol: 'Li', name: 'Lithium', mass: '6.941', group: 1, period: 2 },
	{ symbol: 'Be', name: 'Beryllium', mass: '9.012182', group: 2, period: 2 },
	{ symbol: 'B', name: 'Boron', mass: '10.811', group: 13, period: 2 },
	{ symbol: 'C', name: 'Carbon', mass: '12.0107', group: 14, period: 2 },
	{ symbol: 'N', name: 'Nitrogen', mass: '14.0067', group: 15, period: 2 },
	{ symbol: 'O', name: 'Oxygen', mass: '15.9994', group: 16, period: 2 },
	{ symbol: 'F', name: 'Fluorine', mass: '18.9984032', group: 17, period: 2 },
	{ symbol: 'Ne', name: 'Neon', mass: '20.1797', group: 18, period: 2 },
	{ symbol: 'Na', name: 'Sodium', mass: '22.98976...', group: 1, period: 3 },
	{ symbol: 'Mg', name: 'Magnesium', mass: '24.305', group: 2, period: 3 },
	{ symbol: 'Al', name: 'Aluminium', mass: '26.9815386', group: 13, period: 3 },
	{ symbol: 'Si', name: 'Silicon', mass: '28.0855', group: 14, period: 3 },
	{ symbol: 'P', name: 'Phosphorus', mass: '30.973762', group: 15, period: 3 },
	{ symbol: 'S', name: 'Sulfur', mass: '32.065', group: 16, period: 3 },
	{ symbol: 'Cl', name: 'Chlorine', mass: '35.453', group: 17, period: 3 },
	{ symbol: 'Ar', name: 'Argon', mass: '39.948', group: 18, period: 3 },
	{ symbol: 'K', name: 'Potassium', mass: '39.948', group: 1, period: 4 },
	{ symbol: 'Ca', name: 'Calcium', mass: '40.078', group: 2, period: 4 },
	{ symbol: 'Sc', name: 'Scandium', mass: '44.955912', group: 3, period: 4 },
	{ symbol: 'Ti', name: 'Titanium', mass: '47.867', group: 4, period: 4 },
	{ symbol: 'V', name: 'Vanadium', mass: '50.9415', group: 5, period: 4 },
	{ symbol: 'Cr', name: 'Chromium', mass: '51.9961', group: 6, period: 4 },
	{ symbol: 'Mn', name: 'Manganese', mass: '54.938045', group: 7, period: 4 },
	{ symbol: 'Fe', name: 'Iron', mass: '55.845', group: 8, period: 4 },
	{ symbol: 'Co', name: 'Cobalt', mass: '58.933195', group: 9, period: 4 },
	{ symbol: 'Ni', name: 'Nickel', mass: '58.6934', group: 10, period: 4 },
	{ symbol: 'Cu', name: 'Copper', mass: '63.546', group: 11, period: 4 },
	{ symbol: 'Zn', name: 'Zinc', mass: '65.38', group: 12, period: 4 },
	{ symbol: 'Ga', name: 'Gallium', mass: '69.723', group: 13, period: 4 },
	{ symbol: 'Ge', name: 'Germanium', mass: '72.63', group: 14, period: 4 },
	{ symbol: 'As', name: 'Arsenic', mass: '74.9216', group: 15, period: 4 },
	{ symbol: 'Se', name: 'Selenium', mass: '78.96', group: 16, period: 4 },
	{ symbol: 'Br', name: 'Bromine', mass: '79.904', group: 17, period: 4 },
	{ symbol: 'Kr', name: 'Krypton', mass: '83.798', group: 18, period: 4 },
	{ symbol: 'Rb', name: 'Rubidium', mass: '85.4678', group: 1, period: 5 },
	{ symbol: 'Sr', name: 'Strontium', mass: '87.62', group: 2, period: 5 },
	{ symbol: 'Y', name: 'Yttrium', mass: '88.90585', group: 3, period: 5 },
	{ symbol: 'Zr', name: 'Zirconium', mass: '91.224', group: 4, period: 5 },
	{ symbol: 'Nb', name: 'Niobium', mass: '92.90628', group: 5, period: 5 },
	{ symbol: 'Mo', name: 'Molybdenum', mass: '95.96', group: 6, period: 5 },
	{ symbol: 'Tc', name: 'Technetium', mass: '(98)', group: 7, period: 5 },
	{ symbol: 'Ru', name: 'Ruthenium', mass: '101.07', group: 8, period: 5 },
	{ symbol: 'Rh', name: 'Rhodium', mass: '102.9055', group: 9, period: 5 },
	{ symbol: 'Pd', name: 'Palladium', mass: '106.42', group: 10, period: 5 },
	{ symbol: 'Ag', name: 'Silver', mass: '107.8682', group: 11, period: 5 },
	{ symbol: 'Cd', name: 'Cadmium', mass: '112.411', group: 12, period: 5 },
	{ symbol: 'In', name: 'Indium', mass: '114.818', group: 13, period: 5 },
	{ symbol: 'Sn', name: 'Tin', mass: '118.71', group: 14, period: 5 },
	{ symbol: 'Sb', name: 'Antimony', mass: '121.76', group: 15, period: 5 },
	{ symbol: 'Te', name: 'Tellurium', mass: '127.6', group: 16, period: 5 },
	{ symbol: 'I', name: 'Iodine', mass: '126.90447', group: 17, period: 5 },
	{ symbol: 'Xe', name: 'Xenon', mass: '131.293', group: 18, period: 5 },
	{ symbol: 'Cs', name: 'Caesium', mass: '132.9054', group: 1, period: 6 },
	{ symbol: 'Ba', name: 'Barium', mass: '132.9054', group: 2, period: 6 },
	{ symbol: 'La', name: 'Lanthanum', mass: '138.90547', group: 4, period: 9 },
	{ symbol: 'Ce', name: 'Cerium', mass: '140.116', group: 5, period: 9 },
	{ symbol: 'Pr', name: 'Praseodymium', mass: '140.90765', group: 6, period: 9 },
	{ symbol: 'Nd', name: 'Neodymium', mass: '144.242', group: 7, period: 9 },
	{ symbol: 'Pm', name: 'Promethium', mass: '(145)', group: 8, period: 9 },
	{ symbol: 'Sm', name: 'Samarium', mass: '150.36', group: 9, period: 9 },
	{ symbol: 'Eu', name: 'Europium', mass: '151.964', group: 10, period: 9 },
	{ symbol: 'Gd', name: 'Gadolinium', mass: '157.25', group: 11, period: 9 },
	{ symbol: 'Tb', name: 'Terbium', mass: '158.92535', group: 12, period: 9 },
	{ symbol: 'Dy', name: 'Dysprosium', mass: '162.5', group: 13, period: 9 },
	{ symbol: 'Ho', name: 'Holmium', mass: '164.93032', group: 14, period: 9 },
	{ symbol: 'Er', name: 'Erbium', mass: '167.259', group: 15, period: 9 },
	{ symbol: 'Tm', name: 'Thulium', mass: '168.93421', group: 16, period: 9 },
	{ symbol: 'Yb', name: 'Ytterbium', mass: '173.054', group: 17, period: 9 },
	{ symbol: 'Lu', name: 'Lutetium', mass: '174.9668', group: 18, period: 9 },
	{ symbol: 'Hf', name: 'Hafnium', mass: '178.49', group: 4, period: 6 },
	{ symbol: 'Ta', name: 'Tantalum', mass: '180.94788', group: 5, period: 6 },
	{ symbol: 'W', name: 'Tungsten', mass: '183.84', group: 6, period: 6 },
	{ symbol: 'Re', name: 'Rhenium', mass: '186.207', group: 7, period: 6 },
	{ symbol: 'Os', name: 'Osmium', mass: '190.23', group: 8, period: 6 },
	{ symbol: 'Ir', name: 'Iridium', mass: '192.217', group: 9, period: 6 },
	{ symbol: 'Pt', name: 'Platinum', mass: '195.084', group: 10, period: 6 },
	{ symbol: 'Au', name: 'Gold', mass: '196.966569', group: 11, period: 6 },
	{ symbol: 'Hg', name: 'Mercury', mass: '200.59', group: 12, period: 6 },
	{ symbol: 'Tl', name: 'Thallium', mass: '204.3833', group: 13, period: 6 },
	{ symbol: 'Pb', name: 'Lead', mass: '207.2', group: 14, period: 6 },
	{ symbol: 'Bi', name: 'Bismuth', mass: '208.9804', group: 15, period: 6 },
	{ symbol: 'Po', name: 'Polonium', mass: '(209)', group: 16, period: 6 },
	{ symbol: 'At', name: 'Astatine', mass: '(210)', group: 17, period: 6 },
	{ symbol: 'Rn', name: 'Radon', mass: '(222)', group: 18, period: 6 },
	{ symbol: 'Fr', name: 'Francium', mass: '(223)', group: 1, period: 7 },
	{ symbol: 'Ra', name: 'Radium', mass: '(226)', group: 2, period: 7 },
	{ symbol: 'Ac', name: 'Actinium', mass: '(227)', group: 4, period: 10 },
	{ symbol: 'Th', name: 'Thorium', mass: '232.03806', group: 5, period: 10 },
	{ symbol: 'Pa', name: 'Protactinium', mass: '231.0588', group: 6, period: 10 },
	{ symbol: 'U', name: 'Uranium', mass: '238.02891', group: 7, period: 10 },
	{ symbol: 'Np', name: 'Neptunium', mass: '(237)', group: 8, period: 10 },
	{ symbol: 'Pu', name: 'Plutonium', mass: '(244)', group: 9, period: 10 },
	{ symbol: 'Am', name: 'Americium', mass: '(243)', group: 10, period: 10 },
	{ symbol: 'Cm', name: 'Curium', mass: '(247)', group: 11, period: 10 },
	{ symbol: 'Bk', name: 'Berkelium', mass: '(247)', group: 12, period: 10 },
	{ symbol: 'Cf', name: 'Californium', mass: '(251)', group: 13, period: 10 },
	{ symbol: 'Es', name: 'Einstenium', mass: '(252)', group: 14, period: 10 },
	{ symbol: 'Fm', name: 'Fermium', mass: '(257)', group: 15, period: 10 },
	{ symbol: 'Md', name: 'Mendelevium', mass: '(258)', group: 16, period: 10 },
	{ symbol: 'No', name: 'Nobelium', mass: '(259)', group: 17, period: 10 },
	{ symbol: 'Lr', name: 'Lawrencium', mass: '(262)', group: 18, period: 10 },
	{ symbol: 'Rf', name: 'Rutherfordium', mass: '(267)', group: 4, period: 7 },
	{ symbol: 'Db', name: 'Dubnium', mass: '(268)', group: 5, period: 7 },
	{ symbol: 'Sg', name: 'Seaborgium', mass: '(271)', group: 6, period: 7 },
	{ symbol: 'Bh', name: 'Bohrium', mass: '(272)', group: 7, period: 7 },
	{ symbol: 'Hs', name: 'Hassium', mass: '(270)', group: 8, period: 7 },
	{ symbol: 'Mt', name: 'Meitnerium', mass: '(276)', group: 9, period: 7 },
	{ symbol: 'Ds', name: 'Darmstadium', mass: '(281)', group: 10, period: 7 },
	{ symbol: 'Rg', name: 'Roentgenium', mass: '(280)', group: 11, period: 7 },
	{ symbol: 'Cn', name: 'Copernicium', mass: '(285)', group: 12, period: 7 },
	{ symbol: 'Nh', name: 'Nihonium', mass: '(286)', group: 13, period: 7 },
	{ symbol: 'Fl', name: 'Flerovium', mass: '(289)', group: 14, period: 7 },
	{ symbol: 'Mc', name: 'Moscovium', mass: '(290)', group: 15, period: 7 },
	{ symbol: 'Lv', name: 'Livermorium', mass: '(293)', group: 16, period: 7 },
	{ symbol: 'Ts', name: 'Tennessine', mass: '(294)', group: 17, period: 7 },
	{ symbol: 'Og', name: 'Oganesson', mass: '(294)', group: 18, period: 7 },
];

/** The camera of the example's table layout: a 40-degree field of view, 3,000 units from the table. */
export const CAMERA = { fov: 40, near: 1, far: 10000, distance: 3000 } as const;

/** The space between cells, in the scene's units, as the example lays the table out. */
export const SPACING = { x: 140, y: 180 } as const;

/** Where the example puts the table's first column and first row, in the scene's units. */
export const TABLE_ORIGIN = { x: -1330, y: 990 } as const;

/** A cell's place in the table layout, from its group and period, as the example computes it. */
export function cellPosition(index: number): [number, number, number] {
	const cell = ELEMENTS[index] as ElementCell;
	return [cell.group * SPACING.x + TABLE_ORIGIN.x, -cell.period * SPACING.y + TABLE_ORIGIN.y, 0];
}

/**
 * An integer hash of a number, as a fraction from 0 up to 1. Integer work only, so every engine and
 * every machine gives the same value.
 */
function hash(value: number): number {
	let x = (value + 0x9e3779b9) >>> 0;
	x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
	x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
	return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/**
 * A cell's tint: the alpha of its cyan background, from a quarter to three quarters, the range the
 * example's `Math.random()` covers. The port takes it from the cell's place instead, so the same
 * cell keeps its color.
 */
export function cellTint(index: number): number {
	return 0.25 + hash(index) * 0.5;
}
