// A normal-mapped ground under a low sun, with a box standing on it. The box's shadow falls across
// the ground, whose normal map tilts its normals hard. The shadow filter compares each stored depth
// with the receiver's plane, and that plane must follow the flat triangles that the shadow map
// holds, not the normal map's tilt: a tilted plane lifts the comparison over the box's near edge
// and lights ground that lies in its shadow.
//
// ?view=shadows draws the shadow factor alone through the debug view. That view reads the vertex
// normal, so its frame shows the shadow that the ground's own plane casts, which the normal map
// does not reach. ?sun=off gives the sun no light, so the frame keeps only the ambient light, the
// floor that a fully shadowed texel shows. ?mapSize= sets the shadow map's texels on each side, and
// ?tilt= the normal map's steepest slope.
//
// ?light=point or ?light=spot stands a light above the box in the sun's place, so the receiver
// plane of a point or spot shadow meets the normal map too. ?power=off gives that light no light,
// the floor, and ?bump=off leaves the normal map out, so a run of it draws the shadow that the
// ground's own plane casts. The spec reads the true shadow from that pair.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The texels on each side of the shadow map, from the sketch module's ?mapSize switch. */
const MAP_SIZE = Number(params.get('mapSize') ?? 256);
/** The normal map's steepest slope, from the sketch module's ?tilt switch. */
const TILT = Number(params.get('tilt') ?? 2);
/** True when the sketch module's ?view=shadows switch draws the shadow factor alone. */
const SHADOWS_VIEW = params.get('view') === 'shadows';
/** True when the sketch module's ?sun=off switch leaves the sun out. */
const NO_SUN = params.get('sun') === 'off';
/** The light above the box: 'point' or 'spot', from the sketch module's ?light switch. */
const LIGHT = params.get('light');
/** False when the sketch module's ?power=off switch gives the light no light. */
const POWER = params.get('power') !== 'off';
/** True when the sketch module's ?bump=off switch leaves the normal map out. */
const NO_BUMP = params.get('bump') === 'off';

/** The texels on each side of the normal map. */
const TEXELS = 64;
/** The domes along each side of one tile of the normal map. */
const DOMES = 4;
/** The flat rotation that lays a plane, made in x and y, on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
/** The sun's direction: low from the left, so the box's shadow stretches across the ground. */
const SUN = [0.55, -0.32, 0.22] as const;

/** A normal map of round domes in tangent space, as linear RGBA8 texels from the bottom row up. */
function domeTexels(): Uint8Array {
	const data = new Uint8Array(TEXELS * TEXELS * 4);
	const cell = TEXELS / DOMES;
	for (let y = 0; y < TEXELS; y++)
		for (let x = 0; x < TEXELS; x++) {
			// Each cell holds a dome, whose slope tilts the normal away from the cell's center.
			const u = ((x + 0.5) % cell) / cell - 0.5;
			const v = ((y + 0.5) % cell) / cell - 0.5;
			const nx = -u * TILT * 2;
			const ny = -v * TILT * 2;
			const length = Math.hypot(nx, ny, 1);
			const at = 4 * (y * TEXELS + x);
			data[at] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
			data[at + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
			data[at + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
			data[at + 3] = 255;
		}
	return data;
}

export default defineSketch(({ scene, materials, geometry, textures, quality, debug }) => {
	quality.set({ governor: false, farCascadeInterval: 1, shadowFilter: 3 });
	scene.setBackground('#202830');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 35,
			position: [12, 10, 16],
			target: [-1, 0.5, -1],
			near: 2,
			far: 120,
		}),
	);
	if (LIGHT === null)
		scene.createDirectionalLight({
			direction: SUN,
			color: '#ffffff',
			intensity: NO_SUN ? 0 : 3,
			castShadows: true,
			shadow: { cascades: 2, mapSize: MAP_SIZE, distance: 40 },
		});
	// The light of the ?light switch stands straight above the box, so the box's own footprint is
	// the shadow that the ground's plane casts.
	const above = {
		position: [0, 8, 0] as const,
		color: '#ffffff',
		intensity: POWER ? 200 : 0,
		range: 30,
		castShadows: true,
	};
	if (LIGHT === 'point') scene.createPointLight(above);
	else if (LIGHT === 'spot')
		scene.createSpotLight({ ...above, direction: [0, -1, 0], angle: 1, penumbra: 0 });
	// The light paths keep a lower ambient floor than the sun's, so a texel that the light does not
	// reach stands out from one that it does.
	scene.createAmbientLight({ color: '#ffffff', intensity: LIGHT === null ? 0.4 : 0.12 });
	scene.createMesh({
		mesh: geometry.plane({ width: 60, height: 60 }),
		material: materials.standard({
			color: '#b0a898',
			roughness: 0.9,
			...(NO_BUMP
				? {}
				: {
						normalMap: textures.fromData({
							width: TEXELS,
							height: TEXELS,
							data: domeTexels(),
							colorSpace: 'linear',
							wrap: 'repeat',
							mipmaps: false,
						}),
						uvTransform: { repeat: [8, 8] },
					}),
		}),
		rotation: FLAT,
		receiveShadows: true,
	});
	// The box stands on the ground, so the depth of its near face runs from the ground upward, and
	// the filter's comparison crosses that face where the receiver's plane tilts away.
	scene.createMesh({
		mesh: geometry.box({ width: 4, height: 3, depth: 4 }),
		material: materials.standard({ color: '#303840', roughness: 1 }),
		position: [0, 1.5, 0],
		castShadows: true,
	});
	if (SHADOWS_VIEW) debug.view('shadows');
});
