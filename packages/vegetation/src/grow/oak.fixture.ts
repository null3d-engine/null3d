// The pedunculate oak's growth and envelope, as the self-organizing grower's tests read them: the
// oak's own record copies these numbers. The envelope is the visual hull of 32 views of the oak's
// reference turntable, one every 11.25 degrees of its turn: each view's silhouette, scaled to the
// tree's height with the trunk at the centre, bounds the crown in a slab across the view at each
// height, and the radius at each of 16 azimuths is the third-nearest bound, which passes over the
// few views where the turntable's tree drifts. The rows are smoothed over neighbouring azimuths, and
// the lowest row, where a hanging limb spikes the hull, takes 85 per cent of the row above.
import type { Species } from '../core/record';
import { standInRecord } from '../core/stand-in';

const base = standInRecord('pedunculate-oak', {
	name: 'Pedunculate oak',
	height: { mean: 20, spread: 2 },
	aspect: 1.45,
	dbh: 1.1,
});

/** The pedunculate oak, open-grown: a broad low dome on a short bole that forks low. */
export const oakRecord: Species = {
	...base,
	latin: 'Quercus robur',
	form: 'broad low dome on a short, low-forking bole',
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		internode: { length: 0.6, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			angle: [
				[0.25, 60],
				[1, 50],
			],
			angleSpread: 15,
			extinction: [0.02, 0.06],
		},
		apical: {
			control: [
				[0, 0.5],
				[0.15, 0.42],
				[1, 0.42],
			],
			dominance: [1.5, 0.6, 0.98],
			wander: 10,
		},
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96 },
		tropism: {
			photo: 0.12,
			gravi: [
				[0, 0.3],
				[0.25, 0.08],
				[1, 0.03],
			],
		},
		shedding: { threshold: 0.1, cleanBole: 0.1, stubs: 0.2 },
		bending: { strength: 0.12, upturn: 0.4 },
		pipe: { exponent: 2.3, tipRadius: 0.004 },
	},
	envelope: {
		kind: 'radial',
		heights: [
			0.115, 0.181, 0.247, 0.313, 0.379, 0.446, 0.512, 0.578, 0.644, 0.711, 0.777, 0.843, 0.909,
			0.975, 1,
		],
		radii: [
			[
				0.512, 0.496, 0.495, 0.513, 0.544, 0.571, 0.586, 0.589, 0.594, 0.607, 0.63, 0.662, 0.672,
				0.635, 0.582, 0.54,
			],
			[
				0.602, 0.583, 0.582, 0.604, 0.64, 0.672, 0.689, 0.692, 0.699, 0.715, 0.741, 0.779, 0.791,
				0.747, 0.684, 0.635,
			],
			[
				0.588, 0.555, 0.531, 0.528, 0.551, 0.591, 0.629, 0.641, 0.641, 0.66, 0.71, 0.768, 0.785,
				0.742, 0.677, 0.626,
			],
			[
				0.582, 0.57, 0.561, 0.562, 0.59, 0.649, 0.696, 0.694, 0.662, 0.643, 0.656, 0.683, 0.683,
				0.655, 0.624, 0.598,
			],
			[
				0.573, 0.586, 0.617, 0.651, 0.677, 0.698, 0.716, 0.718, 0.705, 0.694, 0.696, 0.708, 0.714,
				0.694, 0.643, 0.591,
			],
			[
				0.607, 0.593, 0.59, 0.61, 0.652, 0.692, 0.705, 0.7, 0.706, 0.722, 0.73, 0.724, 0.713, 0.697,
				0.67, 0.634,
			],
			[
				0.602, 0.594, 0.601, 0.619, 0.624, 0.6, 0.582, 0.603, 0.643, 0.663, 0.667, 0.699, 0.743,
				0.727, 0.666, 0.624,
			],
			[
				0.577, 0.572, 0.573, 0.574, 0.55, 0.517, 0.516, 0.535, 0.549, 0.563, 0.59, 0.639, 0.694,
				0.69, 0.63, 0.59,
			],
			[
				0.524, 0.518, 0.498, 0.474, 0.462, 0.46, 0.463, 0.474, 0.496, 0.529, 0.567, 0.606, 0.655,
				0.676, 0.619, 0.547,
			],
			[
				0.401, 0.387, 0.398, 0.414, 0.413, 0.405, 0.401, 0.406, 0.426, 0.451, 0.482, 0.518, 0.558,
				0.59, 0.547, 0.457,
			],
			[
				0.402, 0.361, 0.355, 0.376, 0.404, 0.407, 0.384, 0.364, 0.358, 0.374, 0.412, 0.444, 0.455,
				0.468, 0.481, 0.457,
			],
			[
				0.367, 0.306, 0.278, 0.278, 0.272, 0.252, 0.243, 0.248, 0.259, 0.279, 0.311, 0.354, 0.393,
				0.411, 0.426, 0.42,
			],
			[
				0.228, 0.196, 0.159, 0.128, 0.116, 0.128, 0.16, 0.195, 0.219, 0.24, 0.279, 0.33, 0.353,
				0.328, 0.284, 0.253,
			],
			[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.011, 0.046, 0.058, 0.023, 0],
			0,
		],
		source: { method: 'turntable-hull', from: 'oak-turntable.mp4', views: 32 },
	},
	shoots: {
		...(base.shoots as NonNullable<Species['shoots']>),
		classes: [
			{
				name: 'long',
				vigor: [0.5, 1],
				share: 0.4,
				length: 0.45,
				nodes: 7,
				internode: 1,
				leafScale: 1,
				leafAngle: 50,
				droop: 5,
			},
			{
				name: 'short',
				vigor: [0, 0.5],
				share: 0.6,
				length: 0.15,
				nodes: 5,
				internode: 1,
				leafScale: 0.9,
				leafAngle: 55,
				droop: 0,
			},
		],
	},
};
