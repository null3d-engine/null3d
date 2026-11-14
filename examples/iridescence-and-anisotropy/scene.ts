// A jeweller's bench at night: a beetle whose shell shows the colors of a thin film, above a
// brushed-metal plinth whose stretched highlight turns as the disc turns, and soap bubbles that
// drift. Thin films and stretched lobes both load shaders on the first material that asks for
// them, so this scene keeps the two apart in its own module.
import { type Object3D, quat, type SketchContext } from '@null3d/engine';

/** Texels of each code-made map along a side. */
const SIZE = 256;

/** A texture's texels from a function of the pixel's column and row. */
function texels(fill: (x: number, y: number) => readonly number[]): Uint8Array {
	const data = new Uint8Array(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) data.set(fill(x, y), (y * SIZE + x) * 4);
	return data;
}

/**
 * The beetle's shell: the film's thickness as rings that run over the carapace, so each ridge shows
 * another color of the spectrum, as a jewel beetle's shell does.
 */
export function thicknessMap(ctx: SketchContext) {
	const data = texels((x, y) => {
		const dx = (x + 0.5) / SIZE - 0.5;
		const dy = (y + 0.5) / SIZE - 0.5;
		const radius = Math.hypot(dx, dy) * 2;
		const ring = 0.5 + 0.5 * Math.sin(radius * Math.PI * 14);
		return [0, Math.round(ring * 255), 0, 255];
	});
	return ctx.textures.fromData({
		width: SIZE,
		height: SIZE,
		data,
		colorSpace: 'linear',
		mipmaps: true,
	});
}

/**
 * The plinth's brushed metal: the anisotropy's direction runs around the disc in the red and green
 * channels, and its strength is full in blue. The highlight then stretches across the grain.
 */
export function brushedMap(ctx: SketchContext) {
	const data = texels((x, y) => {
		const dx = (x + 0.5) / SIZE - 0.5;
		const dy = (y + 0.5) / SIZE - 0.5;
		const length = Math.max(Math.hypot(dx, dy), 1e-4);
		// Across the grain, at right angles to the radius.
		const u = -dy / length;
		const v = dx / length;
		return [Math.round((u * 0.5 + 0.5) * 255), Math.round((v * 0.5 + 0.5) * 255), 255, 255];
	});
	return ctx.textures.fromData({
		width: SIZE,
		height: SIZE,
		data,
		colorSpace: 'linear',
		mipmaps: true,
	});
}

/** The beetle: a shell of thin film over dark metal, its head and legs plain dark chitin. */
export function createBeetle(ctx: SketchContext, parent: Object3D) {
	const { scene, geometry, materials } = ctx;
	const root = scene.createGroup({ parent, position: [0, 0.44, 0], dynamic: true });
	const shell = materials.standard({
		color: '#0d3a24',
		metalness: 1,
		roughness: 0.22,
		iridescence: 1,
		iridescenceIor: 1.9,
		iridescenceThicknessRange: [180, 620],
		iridescenceThicknessMap: thicknessMap(ctx),
	});
	const chitin = materials.standard({
		color: '#0a2418',
		metalness: 0.6,
		roughness: 0.35,
		iridescence: 0.45,
		iridescenceIor: 1.6,
		iridescenceThicknessRange: [300, 520],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.5, widthSegments: 96, heightSegments: 48 }),
		material: shell,
		parent: root,
		scale: [0.8, 0.52, 1.15],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.21, widthSegments: 48, heightSegments: 24 }),
		material: chitin,
		parent: root,
		position: [0, 0.02, 0.62],
		scale: [1, 0.9, 0.8],
		castShadows: true,
	});
	// A seam between the wing cases, which catches a thin line of light.
	scene.createMesh({
		mesh: geometry.box({ width: 0.012, height: 0.012, depth: 1.02 }),
		material: chitin,
		parent: root,
		position: [0, 0.255, 0.02],
	});
	for (const side of [-1, 1]) {
		for (let k = 0; k < 3; k++) {
			scene.createMesh({
				mesh: geometry.cylinder({ radiusTop: 0.018, radiusBottom: 0.024, height: 0.34 }),
				material: chitin,
				parent: root,
				position: [side * (0.26 + k * 0.05), -0.24, 0.34 - k * 0.22],
				rotation: quat.fromEuler(quat.create(), 0.5, 0, side * (0.5 + k * 0.25)),
			});
		}
		scene.createMesh({
			mesh: geometry.cylinder({ radiusTop: 0.008, radiusBottom: 0.014, height: 0.3 }),
			material: chitin,
			parent: root,
			position: [side * 0.08, 0.16, 0.78],
			rotation: quat.fromEuler(quat.create(), 1.1, 0, side * 0.5),
		});
	}
	return root;
}

/**
 * The plinth: a brushed disc that turns, its grain stretching each highlight across the radius,
 * and a ring of polished metal around it.
 */
export function createBench(ctx: SketchContext, parent: Object3D) {
	const { scene, geometry, materials } = ctx;
	const grain = materials.standard({
		color: '#c9ced8',
		metalness: 1,
		roughness: 0.28,
		anisotropy: 0.85,
		anisotropyRotation: 0,
		anisotropyMap: brushedMap(ctx),
	});
	const disc = scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 1.35,
			radiusBottom: 1.35,
			height: 0.18,
			radialSegments: 128,
		}),
		material: grain,
		parent,
		position: [0, 0.09, 0],
		receiveShadows: true,
		castShadows: true,
	});
	scene.createMesh({
		mesh: geometry.torus({ radius: 1.38, tube: 0.035, tubularSegments: 192, radialSegments: 16 }),
		material: materials.standard({ color: '#e8c98a', metalness: 1, roughness: 0.12 }),
		parent: disc,
		position: [0, 0.075, 0],
		rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	return disc;
}

/** Soap bubbles that drift above the bench: thin walls that let light through, tinted by a film. */
export function createBubbles(ctx: SketchContext, parent: Object3D) {
	const { scene, geometry, materials } = ctx;
	const film = (ior: number, thickness: readonly [number, number]) =>
		materials.standard({
			color: '#ffffff',
			metalness: 0,
			roughness: 0.02,
			transmission: 1,
			thickness: 0.002,
			ior: 1.33,
			iridescence: 1,
			iridescenceIor: ior,
			iridescenceThicknessRange: thickness,
		});
	const bubbles = [
		{ radius: 0.42, at: [1.05, 0.85, 0.15], film: film(1.35, [120, 380]) },
		{ radius: 0.3, at: [1.35, 1.35, -0.35], film: film(1.5, [200, 520]) },
		{ radius: 0.24, at: [0.85, 1.5, 0.45], film: film(1.25, [300, 700]) },
	] as const;
	return bubbles.map(({ radius, at, film: material }) =>
		scene.createMesh({
			mesh: geometry.sphere({ radius, widthSegments: 64, heightSegments: 32 }),
			material,
			parent,
			position: [at[0], at[1], at[2]],
			dynamic: true,
		}),
	);
}

/**
 * The oil slick on the bench's floor: a film over a dark wet stone, its thickness in slow swirls,
 * so the ring of colors turns as the view moves.
 */
export function createSlick(ctx: SketchContext) {
	const { scene, geometry, materials } = ctx;
	const swirls = texels((x, y) => {
		const u = (x + 0.5) / SIZE - 0.5;
		const v = (y + 0.5) / SIZE - 0.5;
		const angle = Math.atan2(v, u);
		const radius = Math.hypot(u, v);
		const wave = 0.5 + 0.5 * Math.sin(radius * 26 + Math.sin(angle * 3) * 2.5);
		return [0, Math.round(wave * 255), 0, 255];
	});
	const thickness = ctx.textures.fromData({
		width: SIZE,
		height: SIZE,
		data: swirls,
		colorSpace: 'linear',
		mipmaps: true,
	});
	return scene.createMesh({
		mesh: geometry.circle({ radius: 2.6, segments: 96 }),
		material: materials.standard({
			color: '#0a0c10',
			metalness: 0.2,
			roughness: 0.08,
			iridescence: 1,
			iridescenceIor: 1.45,
			iridescenceThicknessRange: [250, 900],
			iridescenceThicknessMap: thickness,
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		position: [0, 0.002, 0],
		receiveShadows: true,
	});
}
