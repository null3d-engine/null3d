// A security camera: at night, a camera on a pole sweeps a wet yard behind a brick wall, or aims
// where the pointer points, and a scene pass draws its view into a texture. A monitor on the near
// side of the wall shows it as a night camera does: gray, brightened, with rolling scan lines. The
// robot that patrols out of the main camera's sight shows there. The pass never draws an object
// that shows its own texture, so the monitor stays out of its own picture. Scene passes draw no
// point or spot lights yet, so the floodlight is the scene's directional light, which the pass
// draws with its shadows, and the night sky fills the shade. The puddles come from code.
import { defineSketch, type Material, math, timeOfDay, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** A quarter turn about X, which lays a plane flat or points a cylinder along Z. */
const QUARTER_X = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
/** The crates behind the wall, clear of the robot's patrol: x, z and the size of each. */
const CRATES = [
	[-4.6, -2.2, 1.1],
	[-3.8, -1.2, 0.6],
	[-1.4, -4.3, 1],
	[-0.4, -3.9, 0.6],
	[4.4, -7.6, 0.9],
];
/** The robot's patrol: an ellipse in meters, a start angle, and radians walked per second. */
const PATROL = { x: 3.2, z: 2, centerZ: -4.6, start: Math.PI, speed: 0.6 };
/** The security camera's place, on top of its pole behind the wall. */
const EYE: Vec3 = [3, 3.9, -0.8];

// The monitor: the feed's brightness, raised and tinted as an infrared camera shows it, with scan
// lines, a brighter band that rolls down, and a darker rim. The screen gives off its picture.
const monitor = /* wgsl */ `
var feed: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let light = dot(textureSample(feed, feedSampler, input.uv).rgb, vec3f(0.2126, 0.7152, 0.0722));
    let lines = 0.8 + 0.2 * sin(input.uv.y * 450.0 + frame.time * 6.0);
    let roll = 1.0 + 0.15 * smoothstep(0.9, 1.0, fract(input.uv.y * 0.5 - frame.time * 0.15));
    let rim = 1.0 - pow(length(input.uv - vec2f(0.5)) * 1.2, 4.0);
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(0.8, 0.95, 1.0) * sqrt(light * 3.0) * lines * roll * rim;
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, render, post, time } = ctx;
	const night = timeOfDay('blueHour');
	const sky = { intensity: night.skyIntensity * 2 };
	scene.setBackground({ sky: { ...night.sky, cloudCoverage: 0.5 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.setFog({ color: '#0b1018', density: 0.03 });
	post.set({ exposure: 1.4, bloom: { intensity: 0.3, threshold: 1 }, vignette: {} });
	// The floodlight: sodium orange, from high over the near side of the wall into the yard.
	const flood = { direction: [-0.6, -1.5, -1.3], color: '#ffc890', intensity: 3.5 } as const;
	scene.createDirectionalLight({ ...flood, castShadows: true, shadow: { distance: 30 } });
	scene.createAmbientLight({ color: '#6c84c8', intensity: 0.2 });

	const box = geometry.box();
	const solid = (color: string, roughness = 0.8) => materials.standard({ color, roughness });
	const glow = (emissive: string, emissiveIntensity: number) =>
		materials.standard({ color: '#000000', emissive, emissiveIntensity });
	const cast = { castShadows: true, receiveShadows: true };
	const block = (material: Material, position: Vec3, scale: Vec3) =>
		scene.createMesh({ mesh: box, material, position, scale, ...cast });

	// Wet gravel: puddles where a few crossed waves add up, a little darker and smooth, the rest rough.
	math.seed(11);
	const [albedo, finish] = [new Uint8Array(64 * 64 * 4), new Uint8Array(64 * 64 * 4)];
	for (let i = 0; i < 64 * 64; i++) {
		const [u, v] = [((i % 64) / 32) * Math.PI, ((i >> 6) / 32) * Math.PI];
		const wet = Math.sin(u * 2) + Math.sin(v * 3 + u) + Math.sin((u - v) * 2) > 0.8;
		const grain = math.randFloat(0.75, 1) * (wet ? 0.9 : 1);
		albedo.set([120 * grain, 116 * grain, 108 * grain, 255], i * 4);
		finish.set([255, wet ? 30 : 140, 0, 255], i * 4);
	}
	const tiled = { width: 64, height: 64, wrap: 'repeat', mipmaps: true } as const;
	const ground = materials.standard({
		map: textures.fromData({ ...tiled, data: albedo, colorSpace: 'srgb', anisotropy: 8 }),
		metalnessRoughnessMap: textures.fromData({ ...tiled, data: finish }),
		uvTransform: { repeat: [24, 24] },
		doubleSided: true,
	});
	const plane = geometry.plane({ width: 40, height: 40 });
	scene.createMesh({ mesh: plane, material: ground, rotation: QUARTER_X, receiveShadows: true });
	block(solid('#6a564c'), [0, 1.4, 0], [12, 2.8, 0.3]);
	block(solid('#4a4038'), [0, 0.9, -9.5], [14, 1.8, 0.2]);
	const [wood, bark, leaves] = [solid('#a07a48'), solid('#4a3424'), solid('#2c5432')];
	for (const [x, z, size] of CRATES) block(wood, [x, size / 2, z], [size, size, size]);
	// A row of trees along the back fence, and the floodlight's lamp on the wall, which blooms.
	const trunk = geometry.cylinder({ radiusTop: 0.15, radiusBottom: 0.2, height: 1.6 });
	const crown = geometry.cone({ radius: 1.3, height: 3.6 });
	for (const x of [-5, 1.4, 5.2]) {
		scene.createMesh({ mesh: trunk, material: bark, position: [x, 0.8, -7.8], ...cast });
		scene.createMesh({ mesh: crown, material: leaves, position: [x, 3.4, -7.8], ...cast });
	}
	block(solid('#2a2d33', 0.4), [3, 3.25, -0.5], [0.5, 0.25, 0.4]);
	block(glow('#ffc48a', 12), [3, 3.11, -0.5], [0.4, 0.04, 0.3]);

	// The robot faces +Z, where its visor glows.
	const body = { mesh: geometry.capsule({ radius: 0.35, height: 0.9 }), castShadows: true };
	const robot = scene.createMesh({ ...body, material: solid('#f2a93b', 0.35), dynamic: true });
	const visor = { mesh: box, material: glow('#4fd8ff', 6), parent: robot };
	scene.createMesh({ ...visor, position: [0, 0.35, 0.3], scale: [0.5, 0.12, 0.12] });

	// The security camera on its pole. Its housing hangs from the camera, behind the lens, so it
	// turns with the camera and stays out of the camera's view.
	block(solid('#5a5f68'), [EYE[0], EYE[1] / 2, EYE[2] + 0.2], [0.14, EYE[1], 0.14]);
	const security = scene.createPerspectiveCamera({ fov: 50, near: 0.3, far: 60, position: EYE });
	const housing = { mesh: box, material: solid('#e8e8e4', 0.4), parent: security };
	scene.createMesh({ ...housing, position: [0, 0.04, 0.25], scale: [0.28, 0.24, 0.46] });
	const lens = geometry.cylinder({ radiusTop: 0.08, radiusBottom: 0.08, height: 0.08 });
	const dark = solid('#1d2430', 0.3);
	scene.createMesh({ mesh: lens, material: dark, rotation: QUARTER_X, parent: security });

	// The scene pass draws the security camera's view into a 16:9 texture, which the monitor shows.
	const size = [512, 288] as const;
	const feed = render.addPass({ kind: 'scene', camera: security, writes: 'security', size });
	const shown = { feed: textures.fromPass(feed) };
	const screen = materials.shader({ wgsl: monitor, roughness: 0.15, textures: shown });
	block(solid('#1a1c21', 0.3), [-1.6, 1.45, 0.22], [3.6, 2.15, 0.12]);
	const picture = geometry.plane({ width: 3.36, height: 1.89 });
	scene.createMesh({ mesh: picture, material: screen, position: [-1.6, 1.45, 0.29] });
	const led = geometry.sphere({ radius: 0.05 });
	scene.createMesh({ mesh: led, material: glow('#ff3030', 6), position: [0.04, 2.4, 0.3] });

	const look: Vec3 = [-0.2, 1.8, 0];
	const camera = scene.createPerspectiveCamera({ position: [-1.398, 2.16, 5.59], target: look });
	scene.setActiveCamera(camera);
	const limits = { maxPolarAngle: Math.PI * 0.48, minDistance: 3, maxDistance: 20 };
	const yard = { groundY: 0, bounds: [-6, 0, -9, 6, 0, -1.5] } as const;
	const view = interact(ctx, camera, { target: look, ...limits, ...yard });
	const aim = vec3.create();

	return {
		onUpdate(dt) {
			// The robot walks its ellipse, turned to face the way it walks.
			const angle = PATROL.start + time.now * PATROL.speed;
			const [sin, cos] = [Math.sin(angle), Math.cos(angle)];
			robot.setPosition(cos * PATROL.x, 0.8, PATROL.centerZ + sin * PATROL.z);
			robot.setRotationEuler(0, Math.atan2(-sin * PATROL.x, cos * PATROL.z), 0);
			// The security camera sweeps from one side of the yard to the other, or aims where pointed.
			view.update(dt);
			view.steer(vec3.set(aim, -Math.sin(time.now * 0.45) * 3.5, 0.6, PATROL.centerZ));
			security.lookAt(aim[0], aim[1], aim[2]);
		},
	};
});
