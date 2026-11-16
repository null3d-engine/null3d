// Extra shapes from @null3d/geometry: a torus knot, four polyhedra, a lathe, an extruded star with
// a bevel, a tube along a closed curve and a flat heart, on a polished stone floor at dusk. Each
// generator returns arrays, which geometry.fromArrays makes into a mesh. A reflection pass mirrors
// the shapes in the floor. The shapes run from glass and metal to glazed clay, and the heart glows
// enough to bloom. Each shape turns back and forth, or toward the pointer while it points.
import { defineSketch, math, timeOfDay, type Vec3 } from '@null3d/engine';
import {
	CatmullRomCurve3,
	dodecahedron,
	extrude,
	icosahedron,
	lathe,
	octahedron,
	Shape,
	shape,
	tetrahedron,
	torusKnot,
	tube,
} from '@null3d/geometry';
import { interact } from '../lib/interact';

/** The floor's height, under the lowest row of shapes, and the point that the camera looks at. */
const FLOOR = -3.2;
const AIM = [0, -0.6, 0] as const;
/** The place of the shape at `i` in reading order: three rows of three. */
const placeOf = (i: number): Vec3 => [((i % 3) - 1) * 2.6, (1 - Math.floor(i / 3)) * 2.2, 0];
/** The lathe's profile: the radius and height of each point, from the foot to the lip of a vase. */
const VASE = [0, -0.7, 0.45, -0.7, 0.55, -0.3, 0.3, 0.2, 0.35, 0.6, 0.45, 0.7];
/** The points of the tube's closed curve, three numbers each. */
const LOOP = [-0.6, -0.3, 0, 0, 0.6, 0.3, 0.6, -0.3, 0, 0, -0.1, -0.5];
/** Clear glass with a pale blue tint in its depth. */
const GLASS = { roughness: 0.02, transmission: 1, thickness: 1.2, attenuationColor: '#7fd3ff' };

/** A five-pointed star, with its points `outer` from its center and its inner corners `inner`. */
function star(outer: number, inner: number): Shape {
	const outline = new Shape();
	for (let k = 0; k < 10; k++) {
		const angle = Math.PI / 2 + (k * Math.PI) / 5;
		const radius = k % 2 === 0 ? outer : inner;
		outline[k === 0 ? 'moveTo' : 'lineTo'](Math.cos(angle) * radius, Math.sin(angle) * radius);
	}
	return outline;
}

/** Splits a flat list of numbers into points of `n` numbers each. */
const points = (list: number[], n: number) =>
	Array.from({ length: list.length / n }, (_, i) => list.slice(i * n, i * n + n));

/** A heart from two Bézier curves, as three.js's shapes example draws one, scaled to fit. */
function heart(): Shape {
	const s = 0.07;
	return new Shape()
		.moveTo(0, -5 * s)
		.bezierCurveTo(-1 * s, -2 * s, -9 * s, 0, -9 * s, 5 * s)
		.bezierCurveTo(-9 * s, 10 * s, -2 * s, 12 * s, 0, 8 * s)
		.bezierCurveTo(2 * s, 12 * s, 9 * s, 10 * s, 9 * s, 5 * s)
		.bezierCurveTo(9 * s, 0, 1 * s, -2 * s, 0, -5 * s);
}

/** Polished stone: the reflection, blurred a little by the floor's faint unevenness. */
const stone = /* wgsl */ `
#import null3d::reflection::{reflection_uv}
var mirror: texture_2d<f32>;
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    let slope = 0.004 * vec2f(sin(p.x * 3.1 + p.y * 1.7), sin(p.y * 2.9 - p.x * 1.3));
    s.normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
    let uv = reflection_uv(camera.viewProjection * vec4f(input.relativePosition, 1.0), slope);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, render, post, time } = ctx;
	const dusk = timeOfDay(17.4, { heading: 0.5 });
	scene.setBackground({ sky: dusk.sky }, { intensity: dusk.skyIntensity });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.6 });
	scene.createAmbientLight({ color: dusk.fog.color, intensity: 0.5 });
	scene.setFog({ color: dusk.fog.color, density: 0.012, sunGlow: dusk.fog.sunGlow });
	post.set({ exposure: dusk.exposure, bloom: { threshold: 1 }, ao: { radius: 0.5 }, vignette: {} });
	scene.createDirectionalLight({ ...dusk.light, castShadows: true, shadow: { distance: 40 } });
	const camera = scene.createPerspectiveCamera({ fov: 40, position: [0, 0.3, 10], target: AIM });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: AIM, planeZ: 3 });
	const plane = { point: [0, FLOOR, 0] } as const;
	const mirror = textures.fromPass(render.addPass({ kind: 'reflection', writes: 'floor', plane }));
	const floor = { wgsl: stone, color: '#16181c', roughness: 0.08, textures: { mirror } };
	scene.createMesh({
		mesh: geometry.plane({ width: 2000, height: 2000 }),
		material: materials.shader(floor),
		position: [0, FLOOR, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	const loop = new CatmullRomCurve3(points(LOOP, 3), true);
	// In reading order, from the knot to the flat heart.
	const shapes = [
		torusKnot({ radius: 0.5, tube: 0.16, tubularSegments: 128, radialSegments: 12 }),
		icosahedron({ radius: 0.75 }),
		dodecahedron({ radius: 0.75 }),
		octahedron({ radius: 0.75, detail: 1 }),
		tetrahedron({ radius: 0.85 }),
		lathe({ points: points(VASE, 2), segments: 48 }),
		extrude({ shapes: star(0.75, 0.32), depth: 0.25, bevelThickness: 0.08, bevelSize: 0.06 }),
		tube({ path: loop, tubularSegments: 96, radius: 0.12, radialSegments: 10, closed: true }),
		shape({ shapes: heart() }),
	];
	// Each shape's surface: metals, glass, glazed clay and plastic. The heart glows, and draws both
	// faces, so it stays in view when the camera orbits behind it.
	const looks = [
		{ color: '#f2c14e', metalness: 1, roughness: 0.15 },
		{ color: '#ffffff', ...GLASS, dispersion: 0.6 },
		{ color: '#3fb8af', roughness: 0.35 },
		{ color: '#e8e8ec', metalness: 1, roughness: 0.05 },
		{ color: '#d98a5f', metalness: 1, roughness: 0.45 },
		{ color: '#2f5fd0', roughness: 0.12 },
		{ color: '#e8554e', roughness: 0.3 },
		{ color: '#c0c4cc', metalness: 1, roughness: 0.3 },
		{ color: '#000000', emissive: '#ff3d7a', emissiveIntensity: 4 },
	];
	const places = shapes.map((_, i) => placeOf(i));
	const meshes = shapes.map((arrays, i) =>
		scene.createMesh({
			mesh: geometry.fromArrays(arrays),
			material: materials.standard({ ...looks[i], doubleSided: i === 8 }),
			position: places[i],
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		}),
	);

	return {
		onUpdate(dt) {
			view.update(dt);
			const { point, steering } = view;
			for (let i = 0; i < meshes.length; i++) {
				// From the shape's place to the pointed point: the turns that face its front there.
				const dx = point[0] - places[i][0];
				const dy = point[1] - places[i][1];
				const tilt = math.lerp(0.35, -Math.atan2(dy, Math.hypot(dx, point[2])), steering);
				const turn = math.lerp(Math.sin(time.now + i * 0.7), Math.atan2(dx, point[2]), steering);
				meshes[i].setRotationEuler(tilt, turn, 0);
			}
		},
	};
});
