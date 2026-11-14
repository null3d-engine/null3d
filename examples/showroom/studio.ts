// The studio: a dark room with a polished mirror floor, three softbox area lights and the reflection
// probe that gives the car's clear coat the room's light. The room opens to the street along one
// end, so the car can drive out. The softboxes are rectangle lights with a glowing panel in front of
// each, and the back wall carries a strip of light that the bloom picks up.
import type { ReflectionProbe, SketchContext, Texture } from '@null3d/engine';
import { MIRROR_FLOOR } from './floor';

/** The room's half width, its depth from the street end, and its height. */
const HALF = 11;
const DEPTH = 22;
const HEIGHT = 7.2;
/** The opening at the street end: its half width and its height. The walls fill the rest. */
const OPEN_HALF = 6;
const OPEN_HEIGHT = 6.5;
/** A quarter turn about X that lays a plane flat, and about Y that stands it across the room. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
const FACE_PLUS_X = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
const FACE_MINUS_X = [0, -Math.SQRT1_2, 0, Math.SQRT1_2] as const;

/** What the studio gives the scene. */
export interface Studio {
	/** The probe that the studio's surfaces reflect, which covers the room and leaves the car out. */
	readonly probe?: ReflectionProbe;
}

/**
 * Builds the studio's room, floor, softboxes and probe. The floor reads the scene's planar reflection
 * pass as a mirror. The car is left out of the probe's capture by its layer, so the paint reflects
 * the room and never itself. `without` names the parts that a measurement leaves out.
 */
export function createStudio(
	ctx: SketchContext,
	mirror: Texture,
	without: ReadonlySet<string> = new Set(),
): Studio {
	const { scene, geometry, materials } = ctx;
	const wall = materials.standard({ color: '#14161b', roughness: 0.82 });
	const ceiling = materials.standard({ color: '#0b0c0f', roughness: 0.9 });
	const floor = materials.shader({
		wgsl: MIRROR_FLOOR,
		textures: { mirror },
		color: '#07080a',
		roughness: 0.035,
	});
	const block = (
		size: readonly [number, number, number],
		position: readonly [number, number, number],
		material: typeof wall,
	) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material,
			position: [...position],
			castShadows: true,
			receiveShadows: true,
		});

	// The floor, and the walls and ceiling that close the room but for the street's opening.
	scene.createMesh({
		mesh: geometry.plane({ width: HALF * 2, height: DEPTH }),
		material: floor,
		position: [0, 0, DEPTH / 2],
		rotation: [...FLAT],
		receiveShadows: true,
	});
	block([0.4, HEIGHT, DEPTH], [-HALF - 0.2, HEIGHT / 2, DEPTH / 2], wall);
	block([0.4, HEIGHT, DEPTH], [HALF + 0.2, HEIGHT / 2, DEPTH / 2], wall);
	block([HALF * 2 + 0.8, HEIGHT, 0.4], [0, HEIGHT / 2, DEPTH + 0.2], wall);
	block([HALF * 2 + 0.8, 0.4, DEPTH + 0.8], [0, HEIGHT + 0.2, DEPTH / 2], ceiling);
	block([HALF - OPEN_HALF, OPEN_HEIGHT, 0.4], [-(OPEN_HALF + HALF) / 2, OPEN_HEIGHT / 2, 0], wall);
	block([HALF - OPEN_HALF, OPEN_HEIGHT, 0.4], [(OPEN_HALF + HALF) / 2, OPEN_HEIGHT / 2, 0], wall);

	// A strip of light along the back wall, and the softboxes' own glowing panels.
	const glow = (color: string, intensity: number) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity: intensity });
	const strip = glow('#b9cdea', 2.6);
	scene.createMesh({
		mesh: geometry.box({ width: 18, height: 0.06, depth: 0.05 }),
		material: strip,
		position: [0, HEIGHT - 0.55, DEPTH - 0.24],
	});
	const panel = (
		width: number,
		height: number,
		position: readonly [number, number, number],
		rotation: readonly [number, number, number, number],
		color: string,
	) =>
		scene.createMesh({
			mesh: geometry.plane({ width, height }),
			material: glow(color, 0.8),
			position: [...position],
			rotation: [...rotation],
		});

	// The softbox above and behind the car, and a thinner box over it, which draw the reflections
	// across the roof and the flanks.
	const key = { width: 5.5, height: 2.2 };
	if (!without.has('arealights'))
		scene.createRectAreaLight({
			position: [0, 6.1, 12],
			direction: [0, -1, 0],
			width: key.width,
			height: key.height,
			range: 18,
			color: '#fff1dc',
			intensity: 300,
		});
	panel(key.width, key.height, [0, 6.16, 12], [Math.SQRT1_2, 0, 0, Math.SQRT1_2], '#fff1dc');
	// A long thin box over the car, whose reflection draws the bright line along the roof and the deck.
	const top = { width: 6.5, height: 0.8 };
	if (!without.has('arealights'))
		scene.createRectAreaLight({
			position: [0, 5, 9],
			direction: [0, -1, 0],
			width: top.width,
			height: top.height,
			range: 14,
			color: '#ffffff',
			intensity: 240,
		});
	panel(top.width, top.height, [0, 5.06, 9], [Math.SQRT1_2, 0, 0, Math.SQRT1_2], '#ffffff');
	// A strip down each side, which lights the flanks and the walls.
	const stripSize = { width: 0.9, height: 5 };
	for (const [side, color] of [
		[-1, '#dfe9ff'],
		[1, '#ffd9b8'],
	] as const) {
		if (!without.has('arealights'))
			scene.createRectAreaLight({
				position: [side * 9.4, 2.9, 10.5],
				direction: [-side, 0, 0],
				width: stripSize.width,
				height: stripSize.height,
				range: 20,
				color,
				intensity: 150,
			});
		panel(
			stripSize.width,
			stripSize.height,
			[side * 9.46, 2.9, 10.5],
			side < 0 ? [...FACE_PLUS_X] : [...FACE_MINUS_X],
			color,
		);
	}
	// A warm spot from the front fills the car's paint, so the body reads deep red under the
	// softboxes' highlights.
	scene.createSpotLight({
		position: [3.5, 5.5, 5.5],
		target: [0, 0.8, 9],
		angle: 0.7,
		penumbra: 0.9,
		range: 18,
		color: '#fff3e6',
		intensity: 180,
	});

	// The probe fills the room's box, so every surface inside it reflects the softboxes and the walls.
	if (without.has('probe')) return {};
	const probe = scene.createReflectionProbe({
		box: { min: [-HALF, 0.01, 0.01], max: [HALF, HEIGHT, DEPTH - 0.01] },
		position: [0, 3, DEPTH / 2],
		blend: 1.5,
	});
	return { probe };
}
