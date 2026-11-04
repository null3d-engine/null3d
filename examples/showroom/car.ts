// The showroom's car: the shared body from `examples/lib/car-body.ts`, painted and fitted from the
// configurator's choices. The paint is the car-paint add-on's material, so the flakes and the clear
// coat change color with the choice. The trim swaps between carbon, brushed steel and gloss black
// on the sills, bumpers, pillars and roof rails; the rims take the wheel's finish; and the lamps'
// glow, and the beams they throw down the street, take the light's color.
import type { Material, Object3D, SketchContext, SpotLight } from '@null3d/engine';
import { createCarPaint } from '../addons/car-paint';
import { createCarBody, WHEEL_RADIUS } from '../lib/car-body';
import { type Config, choice } from './config';
import { wheelTurn } from './route';

/** The layer that the car draws on, which the studio's reflection probe leaves out. */
export const CAR_LAYER = 1 << 1;

/** What `createCar` gives the scene. */
export interface ShowroomCar {
	/** The group that carries the whole car. Move and turn it to drive. */
	readonly root: Object3D;
	/** Puts the chosen paint, wheels, trim and lights on the car. */
	apply(config: Config): void;
	/** Rolls the wheels as far as the car has travelled forward, in meters. */
	roll(distance: number): void;
}

/** The beam of each head lamp: where it sits on the nose, and how wide and far it throws. */
const BEAM = {
	position: [1.6, 0.58, 0.55] as const,
	angle: 0.5,
	penumbra: 0.55,
	range: 46,
	intensity: 52,
};

/**
 * Builds the car under `parent`. It starts in the studio's first configuration, and `apply` changes
 * that without a rebuild: the materials stay, and only their colors move.
 */
export function createCar(ctx: SketchContext, parent?: Object3D): ShowroomCar {
	const { scene, materials } = ctx;
	const root = scene.createGroup({ parent, position: [0, 0, 0] });
	const paint = createCarPaint(ctx, {
		color: '#9e0b16',
		metalness: 0.65,
		roughness: 0.25,
		// The flakes catch the studio's softboxes, but a bounded glint keeps them from sparkling
		// into noise as the car moves: a wider light and a lower ceiling spread each flake's light.
		flakes: { cells: [120, 210], tilt: 0.25, angle: 0.38, max: 10 },
		seams: { spacing: [0.34, 0], width: 0.0022, shade: 0.85 },
		clearcoat: 1,
		clearcoatRoughness: 0.04,
	});
	const trims: Record<string, Material> = {
		carbon: createCarPaint(ctx, {
			color: '#141619',
			metalness: 0.25,
			roughness: 0.42,
			flakes: false,
			seams: false,
			weave: { cells: [70, 120], shine: 0.9 },
			clearcoat: 0.85,
			clearcoatRoughness: 0.08,
		}),
		steel: materials.standard({ color: '#9aa0a8', metalness: 1, roughness: 0.28 }),
		black: materials.standard({
			color: '#0b0c0f',
			metalness: 0.5,
			roughness: 0.08,
			clearcoat: 1,
			clearcoatRoughness: 0.03,
		}),
	};
	const lamp = (color: string, emissiveIntensity: number) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity });
	const headlamp = lamp('#eaf3ff', 6);
	const rim = materials.standard({ color: '#cfd3da', metalness: 1, roughness: 0.22 });
	const body = createCarBody(
		ctx,
		root,
		{
			paint,
			trim: trims.carbon as Material,
			glass: materials.standard({
				color: '#020304',
				roughness: 0.05,
				clearcoat: 1,
				clearcoatRoughness: 0,
			}),
			headlamp,
			taillamp: lamp('#ff0000', 2),
			rubber: materials.standard({
				color: '#101113',
				roughness: 0.8,
				sheenColor: '#4a4f57',
				sheenRoughness: 0.5,
			}),
			rim,
			dark: materials.standard({ color: '#2a2c30', metalness: 1, roughness: 0.5 }),
		},
		CAR_LAYER,
	);
	// A low glow under the car marks it at night and on the wet road, in the chosen color.
	const under = scene.createPointLight({
		parent: root,
		position: [0, 0.3, 0],
		range: 3.2,
		intensity: 6,
		color: '#eaf3ff',
	});
	// Two head lamps light the street ahead of the car, in the chosen light's color.
	const beams: SpotLight[] = [1, -1].map((side) =>
		scene.createSpotLight({
			parent: root,
			position: [BEAM.position[0], BEAM.position[1], side * BEAM.position[2]],
			direction: [1, -0.1, 0],
			angle: BEAM.angle,
			penumbra: BEAM.penumbra,
			range: BEAM.range,
			intensity: BEAM.intensity,
			color: '#eaf3ff',
		}),
	);
	let trimValue = 'carbon';
	/** The distance that the car has driven forward, which sets each wheel's turn. */
	let travelled = 0;

	const apply = (config: Config): void => {
		paint.set({ color: choice(config, 'paint').value });
		rim.set({ color: choice(config, 'wheels').value });
		const trim = choice(config, 'trim').value;
		if (trim !== trimValue) {
			trimValue = trim;
			const material = trims[trim] ?? trims.carbon;
			if (material) {
				body.lower.setMaterial(material);
				body.pillars.setMaterial(material);
			}
		}
		const light = choice(config, 'lights').value;
		headlamp.set({ emissive: light });
		for (const beam of beams) beam.setColor(light);
		under.setColor(light);
	};

	const roll = (distance: number): void => {
		travelled += distance;
		for (const wheel of body.wheels)
			wheel.spin.setRotationEuler(0, wheelTurn(travelled, WHEEL_RADIUS, wheel.outward), 0);
	};

	return { root, apply, roll };
}
