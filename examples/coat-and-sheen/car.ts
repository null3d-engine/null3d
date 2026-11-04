// The car of the clear coat and sheen demo (sketch.ts), built in code: a body and a cabin of
// rounded box sections swept along the car, so the coat's reflections flow along them. The paint is
// candy red metal with glinting flakes and door seams, the trim is glossy carbon fibre, the cabin
// is dark glass framed by thin pillars and roof rails, and the lamps glow. The body's geometry is
// shared with the showroom demo, which repaints the same car from a configurator.
import type { Material, Object3D, SketchContext } from '@null3d/engine';
import { createCarPaint } from '../addons/car-paint';
import { createCarBody } from '../lib/car-body';

/** Candy red metallic paint with glinting flakes and door seams under the smooth coat. */
function paint(ctx: SketchContext): Material {
	return createCarPaint(ctx, {
		color: '#9e0b16',
		metalness: 0.72,
		roughness: 0.34,
		flakes: { cells: [120, 210], tilt: 0.25 },
		// Door gaps at intervals along the body, and no seam around it.
		seams: { spacing: [0.34, 0], width: 0.0022, shade: 0.85 },
		clearcoat: 1,
		clearcoatRoughness: 0.02,
	});
}

/** Glossy carbon fibre: a dark twill whose tows stretch their highlight along their length. */
function carbon(ctx: SketchContext): Material {
	return createCarPaint(ctx, {
		color: '#141619',
		metalness: 0.25,
		roughness: 0.42,
		flakes: false,
		seams: false,
		weave: { cells: [70, 120], shine: 0.9 },
		clearcoat: 0.85,
		clearcoatRoughness: 0.08,
	});
}

/** Builds the car under `parent`, its body and roof in candy red paint. */
export function createCar(ctx: SketchContext, parent: Object3D): void {
	const { materials } = ctx;
	const lamp = (color: string, emissiveIntensity: number) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity });
	createCarBody(ctx, parent, {
		paint: paint(ctx),
		trim: carbon(ctx),
		glass: materials.standard({
			color: '#020304',
			roughness: 0.05,
			clearcoat: 1,
			clearcoatRoughness: 0,
		}),
		headlamp: lamp('#eaf3ff', 6),
		taillamp: lamp('#ff0000', 2),
		rubber: materials.standard({
			color: '#101113',
			roughness: 0.8,
			sheenColor: '#4a4f57',
			sheenRoughness: 0.5,
		}),
		rim: materials.standard({ color: '#cfd3da', metalness: 1, roughness: 0.22 }),
		dark: materials.standard({ color: '#2a2c30', metalness: 1, roughness: 0.5 }),
	});
}
