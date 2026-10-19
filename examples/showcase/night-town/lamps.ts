// The night town's street lamps: iron posts with warm lanterns that throw the town's own light and
// glow through the bloom. Each lantern is a point light, a glass shade that gives off light, and a
// soft sprite around it that the fog and the bloom turn into haze.
import { type MeshGeometry, type QualityPreset, quat, type SketchContext } from '@null3d/engine';
import { markEffect } from '../../lib/layers';
import { random } from '../../lib/procedural';
import { groundHeight } from './land';

/** The lamps' places, along the square's edges and down the lanes, art-directed by hand. */
export const LAMPS: readonly (readonly [number, number])[] = [
	[-6.6, 8.6],
	[6.6, 8.6],
	[-6.6, -8.6],
	[6.6, -8.6],
	[-3.9, 15.5],
	[3.9, 21],
	[-3.9, -15.5],
	[3.9, -20],
	[15, -3.9],
	[21, 3.9],
	[-15, 3.9],
	[-20, -3.9],
];

/** How high the lantern hangs, in meters. */
const HEIGHT = 3.7;
/** The lamps that cast shadows: enough for the square, and cheap enough for the shadow atlas. */
const SHADOW_CASTERS = 2;
/** The lanterns lit, at each preset: the far lanes go dark on the phones, saving their lights. */
const LIT: Record<QualityPreset, number> = { low: 6, medium: 9, high: 12, ultra: 12 };

/** The glow around a lantern: soft, warm and broad, so the fog reads as lit air. */
function glow({ textures }: SketchContext) {
	const size = 64;
	const data = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		const r =
			Math.hypot((i % size) - (size - 1) / 2, Math.floor(i / size) - (size - 1) / 2) / (size / 2);
		data.set([255, 236, 196, Math.round(255 * Math.max(0, 1 - r) ** 2.4)], i * 4);
	}
	return textures.fromData({ width: size, height: size, data, mipmaps: true });
}

/** The town's lamps, with the glow that follows them and a way to light only the nearest. */
export async function createLamps(
	ctx: SketchContext,
): Promise<{ fit(preset: QualityPreset): void; power(share: number): void; count: number }> {
	const { scene, geometry, materials } = ctx;
	const next = random(97);
	const places = LAMPS.map(([x, z]) => ({ x, z, y: groundHeight(x, z) }));
	const post = geometry.cylinder({
		radiusTop: 0.045,
		radiusBottom: 0.09,
		height: HEIGHT - 0.25,
		radialSegments: 8,
	});
	const base = geometry.cylinder({
		radiusTop: 0.15,
		radiusBottom: 0.22,
		height: 0.32,
		radialSegments: 8,
	});
	const cap = geometry.cone({ radius: 0.22, height: 0.3, radialSegments: 8 });
	const iron = materials.standard({ color: '#191b1e', roughness: 0.55, metalness: 0.6 });

	const add = (mesh: MeshGeometry, y: number) => {
		const batch = scene.createInstances(mesh, places.length, { material: iron, castShadows: true });
		places.forEach((p, k) => {
			batch.positions.set([p.x, p.y + y, p.z], k * 3);
			batch.rotations.set(quat.create(), k * 4);
		});
		batch.markDirty();
	};
	add(base, 0.16);
	add(post, 0.3 + (HEIGHT - 0.25) / 2);
	add(cap, HEIGHT + 0.15);

	// The glass shades: a warm band that gives off light, drawn with the emissive material.
	const glass = scene.createInstances(
		geometry.cylinder({
			radiusTop: 0.15,
			radiusBottom: 0.17,
			height: 0.34,
			radialSegments: 8,
			openEnded: true,
		}),
		places.length,
		{
			material: materials.standard({
				color: '#3a2a12',
				emissive: '#ffcf88',
				emissiveIntensity: 3.2,
				roughness: 0.35,
			}),
		},
	);
	places.forEach((p, k) => {
		glass.positions.set([p.x, p.y + HEIGHT, p.z], k * 3);
	});
	glass.markDirty();

	// The point lights, and the glow sprites that the fog turns into haze.
	const brightness = places.map(() => 1150 + 120 * next());
	const lights = places.map((p, k) =>
		scene.createPointLight({
			range: 17,
			intensity: brightness[k] as number,
			intensityUnit: 'lumen',
			color: '#ffb86a',
			castShadows: k < SHADOW_CASTERS,
			position: [p.x, p.y + HEIGHT, p.z],
		}),
	);
	const glowSprites = await scene.createSprites({
		count: places.length,
		map: glow(ctx),
		blending: 'additive',
		depthWrite: false,
	});
	markEffect(glowSprites);
	places.forEach((p, k) => {
		glowSprites.positions.set([p.x, p.y + HEIGHT, p.z], k * 3);
		glowSprites.sizes.set([4.2, 4.2], k * 2);
	});
	glowSprites.markDirty();

	/** How many lanterns this preset lights. */
	let lit = places.length;
	/** The share of their light that the hour allows: none by day, all at night. */
	let power = 1;
	/** Writes the share of the light that the lanterns give, at the preset's count. */
	const apply = (): void => {
		glowSprites.setActiveCount(lit);
		for (let k = 0; k < places.length; k++) {
			lights[k]?.setIntensity(k < lit ? (brightness[k] as number) * power : 0);
			glowSprites.colors.set([1.5 * power, 1.05 * power, 0.5 * power, 0.5 * power], k * 4);
		}
		glowSprites.markDirty();
	};
	apply();
	return {
		count: places.length,
		fit(preset) {
			lit = LIT[preset];
			// The far lights go dark at the lower presets, so a phone pays for fewer point lights.
			apply();
		},
		power(share) {
			power = share;
			apply();
		},
	};
}
