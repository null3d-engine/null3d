// Rain from a vertex count alone: 50,000 streaks, each made by the shader from its instance index
// and the frame's time, in one draw that uploads nothing per frame. The streaks fill a box that
// wraps around the camera, so the camera never runs out of rain, and the object's sphere culls the
// whole field. A lamp-lit city street shows the streaks against the light, and the pointer turns
// the camera.
import { defineSketch, type Quat, quat } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The streaks in the field. */
const STREAKS = 50_000;
/** The rotation with no turn, which each mesh below turns on its own axis. */
const NO_TURN: Quat = [0, 0, 0, 1];

const rain = /* wgsl */ `
#import null3d::builtins::{camera, fill_builtins, frame}
#import null3d::mesh::finish
#import null3d::noise::{random}
#import null3d::wrap::wrap_relative

// The box around the camera that the streaks fill, its half-size on each axis in meters.
const HALF = vec3f(24.0, 16.0, 24.0);
// The meters that a streak travels each second, which sets its slope, and its length in meters.
const SPEED = vec3f(3.0, -22.0, 0.0);
const LENGTH = 0.9;

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) edge: vec2f,
    @location(1) fade: f32,
    @location(2) bright: f32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varyings {
    fill_builtins(vec3f(0.0));
    // Three random numbers give the streak its place in the box, its speed and its brightness.
    let seed = instance * 3u;
    let home = vec3f(random(seed), random(seed + 1u), random(seed + 2u));
    // The streak's head falls with time and drifts with the wind, then wraps back into the box.
    var place = (home - 0.5) * 2.0 * HALF;
    place += SPEED * frame.time * (0.7 + home.y * 0.6);
    let head = wrap_relative(place, HALF);
    // The card's six vertices, two triangles of a square, counterclockwise in the camera's plane:
    // it stretches from the head to the tail and holds its width across the camera's right, so a
    // streak stays thin from every side.
    let right = normalize(vec3f(camera.view[0][0], camera.view[1][0], camera.view[2][0]));
    let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u)) * 2.0 - 1.0;
    let along = corner.y * 0.5 + 0.5;
    let tail = head - normalize(SPEED) * LENGTH * (0.7 + home.z * 0.6);
    let p = mix(head, tail, along) + right * corner.x * 0.03;
    // A streak fades where it comes near the box's edge, so it never appears out of nothing.
    let away = abs(head) / HALF;
    let edge = max(away.x, max(away.y, away.z));
    var out: Varyings;
    out.clip = camera.viewProjection * vec4f(p, 1.0);
    out.edge = corner;
    out.fade = (1.0 - smoothstep(0.8, 1.0, edge)) * smoothstep(0.0, 0.15, along);
    out.bright = 0.6 + home.y * 0.6;
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    fill_builtins(vec3f(0.0));
    // The card's middle is brightest, and its head brighter than its tail.
    let side = 1.0 - abs(in.edge.x);
    let light = vec3f(0.5, 0.62, 0.8) * side * in.fade * in.bright * (1.3 - in.edge.y * 0.4);
    return finish(light, in.clip.xy);
}
`;

export default defineSketch((ctx) => {
	const { scene, geometry, materials: make, post } = ctx;
	scene.setBackground('#080d14');
	scene.setFog({ color: '#0c141f', density: 0.016 });
	scene.createDirectionalLight({
		direction: [-0.4, -1, -0.3],
		intensity: 1.6,
		color: '#9db8e0',
	});
	post.set({ bloom: { intensity: 0.5, threshold: 1 }, vignette: {} });

	// A wet street between dark fronts, with a lamp over the road every ten meters.
	const road = make.standard({ color: '#2b3440', roughness: 0.35 });
	scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 140 }),
		material: road,
		position: [0, 0, -30],
		rotation: quat.setAxisAngle(NO_TURN, [1, 0, 0], -Math.PI / 2),
	});
	const wall = make.standard({ color: '#333c48', roughness: 0.85 });
	const pane = make.unlit({ color: '#ffce8f' });
	const lamp = make.unlit({ color: '#ffd9a0' });
	for (let side = -1; side <= 1; side += 2) {
		scene.createMesh({
			mesh: geometry.box({ width: 6, height: 18, depth: 60 }),
			material: wall,
			position: [side * 8.5, 9, -26],
		});
		for (let i = 0; i < 12; i++)
			for (let floor = 0; floor < 4; floor++)
				scene.createMesh({
					mesh: geometry.plane({ width: 1.4, height: 1.1 }),
					material: pane,
					position: [side * 5.6, 2.4 + floor * 2.6, 2 - i * 4.2],
					rotation: quat.setAxisAngle(NO_TURN, [0, 1, 0], (side * -Math.PI) / 2),
				});
	}
	for (let i = 0; i < 4; i++) {
		scene.createMesh({
			mesh: geometry.sphere({ radius: 0.14 }),
			material: lamp,
			position: [0, 4.6, 3 - i * 10],
		});
		scene.createPointLight({
			position: [0, 4.4, 3 - i * 10],
			intensity: 45,
			range: 14,
			color: '#ffb469',
		});
	}

	const camera = scene.createPerspectiveCamera({
		fov: 55,
		position: [0, 2.8, 12],
		target: [0, 2.0, -12],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 2.0, -12] });

	// The streaks make every vertex themselves, so this draw holds a count and a sphere and no
	// mesh: a frame of 50,000 downpours uploads no vertex data.
	scene.createVertexDraw({
		shader: rain,
		vertices: 6,
		instances: STREAKS,
		bounds: { center: [0, 8, 0], radius: 48 },
		blending: 'additive',
		depthWrite: false,
	});
	return { onUpdate: (dt: number) => view.update(dt) };
});
