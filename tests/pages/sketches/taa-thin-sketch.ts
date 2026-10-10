// Thin geometry for the temporal anti-aliasing prototype (M2-EX18): a near picket fence, a far one
// whose pickets are thinner than a pixel, power wires against a bright sky, and a mesh of lines one
// pixel wide. These shimmer most when the camera moves. The camera circles a point between the
// fences. It takes the Creek's prototype switches: ?aa=, ?fixed, ?step, ?orbit= and ?frames. An
// address whose last value holds a dot, such as orbit=0.1, makes the dev server read the module as
// JavaScript, so a page ends the address with another switch.
import { defineSketch, type PostSettings } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const MODES: Record<string, PostSettings> = {
	msaa: { taa: false, msaaFxaa: false },
	fxaa: { taa: false, msaaFxaa: true },
	taa: { taa: true, msaaFxaa: false },
	'taa-linear': { taa: { filter: 'linear' }, msaaFxaa: false },
	'taa-still': { taa: { jitter: false }, msaaFxaa: false },
	'taa-80': { taa: { feedback: 0.8 }, msaaFxaa: false },
	'taa-light': { taa: { depth: 'light' }, msaaFxaa: false },
};
const ORBIT = Number(params.get('orbit') ?? '0.1');
const TARGET = [0, 1.2, -8] as const;
const RADIUS = 9;

export default defineSketch(async ({ scene, geometry, materials, post, quality, page, time }) => {
	if (params.has('step')) (globalThis as { __null3dFixedStep?: number }).__null3dFixedStep = 1 / 60;
	if (params.has('fixed')) quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	const aa = params.get('aa');
	const mode = aa === null ? undefined : MODES[aa];
	if (mode) post.set(mode);
	// ?bloom draws on HDR color with a faint bloom, as the Creek does, so TAA's cost leaves out the move to HDR.
	if (params.has('bloom')) post.set({ bloom: { intensity: 0.05, threshold: 1 } });
	scene.setBackground('#9cc4e8');
	scene.createAmbientLight({ color: '#c8d8ff', intensity: 0.5 });
	scene.createDirectionalLight({
		direction: [-0.4, -1, -0.3],
		color: '#fff4e0',
		intensity: 2.5,
		castShadows: true,
	});
	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.05, far: 500 });
	scene.setActiveCamera(camera);
	const ground = materials.standard({ color: '#5d7a3a', roughness: 0.95 });
	const floor = scene.createMesh({
		mesh: geometry.plane({ width: 200, height: 200 }),
		material: ground,
		receiveShadows: true,
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
	const white = materials.standard({ color: '#f2efe8', roughness: 0.7 });
	const dark = materials.standard({ color: '#202020', roughness: 0.6 });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	// Two fences: pickets 3 cm wide every 12 cm near, 2 cm every 10 cm far, with two rails each.
	const fences = [
		{ z: -5, width: 0.03, gap: 0.12, height: 1.1, length: 40 },
		{ z: -22, width: 0.02, gap: 0.1, height: 1.4, length: 80 },
	];
	for (const fence of fences) {
		const count = Math.floor(fence.length / fence.gap);
		const pickets = scene.createInstances(box, count, { material: white, castShadows: true });
		for (let i = 0; i < count; i++) {
			const x = -fence.length / 2 + i * fence.gap;
			pickets.positions.set([x, fence.height / 2, fence.z], i * 3);
			pickets.scales.set([fence.width, fence.height, fence.width], i * 3);
		}
		pickets.markDirty();
		for (const y of [0.3, fence.height - 0.2]) {
			scene.createMesh({
				mesh: box,
				material: white,
				position: [0, y, fence.z - fence.width],
				scale: [fence.length, 0.04, 0.02],
				castShadows: true,
			});
		}
	}
	// Power poles and three sagging wires 1 cm thick, against the sky.
	const poles = [-30, -10, 10, 30] as const;
	for (const x of poles) {
		scene.createMesh({
			mesh: box,
			material: dark,
			position: [x, 4, -14],
			scale: [0.15, 8, 0.15],
		});
	}
	const segments = 24;
	const span = poles.length - 1;
	const wire = scene.createInstances(box, span * segments * 3, { material: dark });
	let row = 0;
	for (let p = 0; p < span; p++) {
		const x0 = poles[p] as number;
		const x1 = poles[p + 1] as number;
		for (let w = 0; w < 3; w++) {
			const height = 7.4 - w * 0.35;
			for (let s = 0; s < segments; s++) {
				const t = (s + 0.5) / segments;
				const sag = 0.8 * 4 * t * (1 - t);
				wire.positions.set([x0 + (x1 - x0) * t, height - sag, -14 + w * 0.05], row * 3);
				wire.scales.set([(x1 - x0) / segments + 0.02, 0.01, 0.01], row * 3);
				row++;
			}
		}
	}
	wire.markDirty();
	// A mesh of lines one pixel wide, like a wire fence, between the two picket fences.
	const positions: number[] = [];
	for (let i = 0; i <= 60; i++) {
		const x = -12 + i * 0.4;
		positions.push(x, 0, -12, x, 2, -12);
	}
	for (let j = 0; j <= 10; j++) {
		const y = j * 0.2;
		positions.push(-12, y, -12, 12, y, -12);
	}
	await scene.createLines({ positions, mode: 'segments', width: 1, color: '#303030' });

	page.onMessage((name) => {
		const on = name === 'taa' || name === 'msaafxaa';
		if (!on && name !== 'taa-off' && name !== 'msaafxaa-off') return;
		if (name.startsWith('taa')) post.set({ taa: on });
		else post.set({ msaaFxaa: on });
		if (on) void scene.warmUp().then(() => page.post('settled', {}));
	});
	const frames = params.has('frames');
	return {
		onUpdate() {
			if (frames) page.post('frame', time.frame);
			const a = 0.35 + ORBIT * time.now;
			camera.setPosition(TARGET[0] + RADIUS * Math.sin(a), 1.7, TARGET[2] + RADIUS * Math.cos(a));
			camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
		},
	};
});
