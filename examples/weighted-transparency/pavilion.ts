// The glass pavilion's scenery: a low evening sun from the left, the built-in room's light for the
// glass to reflect, paving made in code, a round stone plinth, the
// iron posts at the corners of the pavilion's two squares of glass, and a brazier of glowing embers
// whose light flickers. The sketch adds the glass and the smoke.
import { math, type Object3D, type PointLight, type SketchContext } from '@null3d/engine';

/** A point toward the sun: low, and to the left of the camera's view. */
const SUN = [-0.88, 0.22, 0.36] as const;

/** Texels along each side of the paving texture, and along each side of one paving stone. */
const SIZE = 64;
const STONE = 32;

/** A pane's place: its center on the ground and its turn about the vertical axis. */
export interface PanePlace {
	x: number;
	z: number;
	turn: number;
}

/**
 * Builds the scenery and returns the places of the eight panes, in two squares, one turned by 45
 * degrees, so each pane crosses two others, a function that makes the brazier's light flicker at a
 * time, and the brazier's bowl, which carries the mode's label.
 */
export async function pavilion(ctx: SketchContext): Promise<{
	panes: PanePlace[];
	flicker: (t: number) => void;
	bowl: Object3D;
}> {
	const { scene, assets, geometry, materials, textures, post } = ctx;
	scene.setBackground({
		sky: { sunPosition: SUN, turbidity: 8, rayleigh: 2, cloudCoverage: 0.35, time: 0 },
	});
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.6 });
	scene.setFog({ color: '#c9b2a4', density: 0.006, sunGlow: 1.5 });
	scene.createDirectionalLight({
		direction: [-SUN[0], -SUN[1], -SUN[2]],
		color: '#ffc896',
		intensity: 3,
		castShadows: true,
		shadow: { distance: 30 },
	});
	scene.createAmbientLight({ color: '#9db4ff', intensity: 0.35 });
	post.set({ bloom: { intensity: 0.2, threshold: 1 }, ao: { radius: 0.5 }, vignette: {} });

	// Paving stones of a few shades with dark joints, and a round plinth.
	math.seed(5);
	const paving = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let i = 0; i < SIZE * SIZE; i++) {
		const joint = i % STONE === 0 || Math.floor(i / SIZE) % STONE === 0;
		paving.fill((joint ? 0.35 : math.randFloat(0.75, 1)) * 255, i * 4, i * 4 + 3);
	}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: SIZE, height: SIZE, data: paving, ...look });
	const ground = materials.standard({
		map,
		color: '#8c8478',
		roughness: 0.9,
		uvTransform: { repeat: [60, 60] },
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 120, height: 120 }),
		material: ground,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	const stone = materials.standard({ color: '#6b6560', roughness: 0.7 });
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 2.9, radiusBottom: 3, height: 0.3, radialSegments: 64 }),
		material: stone,
		position: [0, 0.15, 0],
		receiveShadows: true,
	});

	// The panes' places, and an iron post at each one's corner.
	const iron = materials.standard({ color: '#2b2622', metalness: 0.8, roughness: 0.45 });
	const pole = geometry.cylinder({ radiusTop: 0.05, radiusBottom: 0.05, height: 2.8 });
	const panes: PanePlace[] = [];
	for (let i = 0; i < 8; i++) {
		const turn = (i >> 2) * (Math.PI / 4) + (i & 3) * (Math.PI / 2);
		panes.push({ x: Math.sin(turn) * 1.8, z: Math.cos(turn) * 1.8, turn });
		const corner = turn + Math.PI / 4;
		const at = [Math.sin(corner) * 2.55, 1.7, Math.cos(corner) * 2.55] as const;
		scene.createMesh({ mesh: pole, material: iron, position: at, castShadows: true });
	}

	// The brazier: an iron bowl on a stem, with embers that glow, and the fire's light.
	const stem = geometry.cylinder({ radiusTop: 0.08, radiusBottom: 0.2, height: 0.9 });
	scene.createMesh({ mesh: stem, material: iron, position: [0, 0.75, 0], castShadows: true });
	const bowl = geometry.cylinder({
		radiusTop: 0.55,
		radiusBottom: 0.3,
		height: 0.35,
		radialSegments: 32,
	});
	const bowlMesh = scene.createMesh({
		mesh: bowl,
		material: iron,
		position: [0, 1.35, 0],
		castShadows: true,
	});
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.5, radiusBottom: 0.5, height: 0.05 }),
		material: materials.standard({ color: '#000000', emissive: '#ff6a1a', emissiveIntensity: 6 }),
		position: [0, 1.5, 0],
	});
	const fire: PointLight = scene.createPointLight({
		position: [0, 1.9, 0],
		color: '#ff8a3c',
		range: 9,
		intensity: 14,
		castShadows: true,
		dynamic: true,
	});
	const flicker = (t: number) =>
		fire.setIntensity(14 + 3 * Math.sin(t * 11) + 2 * Math.sin(t * 17.3) + Math.sin(t * 29));
	return { panes, flicker, bowl: bowlMesh };
}
