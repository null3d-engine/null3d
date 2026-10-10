// A field of grass for the cost of row values (tests/pages/grass-cost.ts): ?count= blades, 100,000
// by default, in a square around the camera's view, under a sun whose shadows the blades cast. The
// message 'sway' draws them with a custom material that sways each blade out of step and tints it,
// from the values of its row, and 'sway-off' draws the same blades still, in the standard material,
// from a batch without values. Both batches are static: the sketch writes no row after its setup,
// so the difference is what the values and the vertex offset cost the GPU and the shadow passes.
import { defineSketch, math } from '@null3d/engine';

const count = Number(new URL(import.meta.url).searchParams.get('count') ?? '100000');
/** The field's side in meters: about 9 blades per square meter. */
const SIDE = Math.sqrt(count / 9);

const grass = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    let h = input.uv.y;
    let bend = sin(frame.time * 1.7 + object.values.x) * 0.2 * h * h;
    return vec3f(bend, 0.0, 0.4 * bend);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor *= mix(vec3f(0.2, 0.45, 0.1), vec3f(0.75, 0.68, 0.22), object.values.y);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, page, time }) => {
	scene.setBackground('#9cb4cc');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 55,
			near: 0.1,
			far: 200,
			position: [0, 3, SIDE / 2 + 4],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.6, -1, -0.4],
		color: '#fff4e0',
		intensity: 3,
		castShadows: true,
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });
	scene.createMesh({
		mesh: geometry.box({ width: SIDE + 4, height: 0.1, depth: SIDE + 4 }),
		material: materials.standard({ color: '#6a5a40' }),
		position: [0, -0.05, 0],
		receiveShadows: true,
	});
	const blade = geometry.plane({ width: 0.04, height: 0.6, heightSegments: 4 });
	const swaying = materials.shader({ wgsl: grass, color: '#ffffff', doubleSided: true });
	const still = materials.standard({ color: '#4a7a28', doubleSided: true });
	const options = { castShadows: true, receiveShadows: true } as const;
	const sway = scene.createInstances(blade, count, { material: swaying, values: true, ...options });
	const plain = scene.createInstances(blade, count, { material: still, ...options });
	const values = sway.values;
	if (!values) throw new Error('a batch with values has values');
	for (let row = 0; row < count; row++) {
		const place = [(math.random() - 0.5) * SIDE, 0.3, (math.random() - 0.5) * SIDE];
		const turn = math.random() * Math.PI;
		const rotation = [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)];
		for (const batch of [sway, plain]) {
			batch.positions.set(place, row * 3);
			batch.rotations.set(rotation, row * 4);
		}
		values.set([math.random() * Math.PI * 2, math.random(), 0, 0], row * 4);
	}
	sway.markDirty();
	plain.markDirty();
	plain.setActiveCount(0);
	page.onMessage((message) => {
		if (message !== 'sway' && message !== 'sway-off') return;
		const on = message === 'sway';
		sway.setActiveCount(on ? count : 0);
		plain.setActiveCount(on ? 0 : count);
		// The frames draw with the new batch once its pipelines are built.
		const frame = time.frame;
		void scene.warmUp().then(() => page.post('settled', { frames: time.frame - frame }));
	});
});
