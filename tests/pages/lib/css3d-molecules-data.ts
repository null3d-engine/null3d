// The molecule that three.js's CSS3D molecules example draws (examples/css3d_molecules.html, r186),
// as plain data: the example's own PDB file for caffeine, centred on the atoms' bounding box as the
// example centres it. No engine type and no page API appears here, so a test can read the data
// without loading the engine or the page's markup.

/** A point in the molecule's space, in Ångströms from the molecule's centre. */
export type Vec = readonly [number, number, number];

/** One atom: its element's symbol, its place from the molecule's centre, and its CPK color. */
export interface Atom {
	readonly element: string;
	readonly position: Vec;
	readonly color: string;
}

/** Caffeine's atoms, in the example's PDB order. */
export const ATOMS: readonly Atom[] = [
	{ element: 'c', position: [-2.06, 1.11, 0], color: '#909090' },
	{ element: 'c', position: [-2.76, -1.3, 0], color: '#909090' },
	{ element: 'c', position: [2.03, 2.48, 0], color: '#909090' },
	{ element: 'c', position: [2.74, -2.31, 0], color: '#909090' },
	{ element: 'o', position: [0.07, -2.56, 0], color: '#ff0d0d' },
	{ element: 'o', position: [3.49, 0.24, 0], color: '#ff0d0d' },
	{ element: 'c', position: [0.49, -1.42, 0], color: '#909090' },
	{ element: 'c', position: [2.29, 0.06, 0], color: '#909090' },
	{ element: 'c', position: [-0.41, -0.33, 0], color: '#909090' },
	{ element: 'c', position: [0.1, 0.95, 0], color: '#909090' },
	{ element: 'n', position: [-0.94, 1.79, 0], color: '#3050f8' },
	{ element: 'n', position: [1.47, 1.13, 0], color: '#3050f8' },
	{ element: 'n', position: [1.81, -1.18, 0], color: '#3050f8' },
	{ element: 'n', position: [-1.78, -0.2, 0], color: '#3050f8' },
	{ element: 'h', position: [-3.05, 1.54, 0], color: '#ffffff' },
	{ element: 'h', position: [-3, -1.57, 1.02], color: '#ffffff' },
	{ element: 'h', position: [-3.66, -0.98, -0.51], color: '#ffffff' },
	{ element: 'h', position: [-2.33, -2.16, -0.51], color: '#ffffff' },
	{ element: 'h', position: [2.17, 2.82, 1.02], color: '#ffffff' },
	{ element: 'h', position: [2.99, 2.48, -0.51], color: '#ffffff' },
	{ element: 'h', position: [1.35, 3.16, -0.51], color: '#ffffff' },
	{ element: 'h', position: [2.97, -2.59, -1.02], color: '#ffffff' },
	{ element: 'h', position: [3.66, -2.02, 0.51], color: '#ffffff' },
	{ element: 'h', position: [2.29, -3.16, 0.51], color: '#ffffff' },
];

/** The atom whose object the port hides, an outer hydrogen, so its element must not show. */
export const HIDDEN_ATOM = 14;
