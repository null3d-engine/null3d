// A scene for the pick test: a backdrop, a pole a few pixels wide, and a card cut by an alpha
// mask. The sketch asks the engine which object each probe pixel shows, and posts the answers with
// a raycast at the mask's hole, which tests triangles and so ignores the mask. The camera never
// moves, so a probe pixel names the same object in every frame.
import { defineSketch } from '@null3d/engine';

/** The size of the mask's texture: a hole of alpha 0 in its middle. */
const MASK_SIZE = 64;
/** The hole's radius, in texels of the mask. */
const HOLE = 12;

/** The texels of the mask: opaque white, with a round hole of alpha 0 in the middle. */
function maskTexels(): Uint8Array {
	const data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4);
	let at = 0;
	for (let y = 0; y < MASK_SIZE; y++) {
		for (let x = 0; x < MASK_SIZE; x++) {
			const dx = x + 0.5 - MASK_SIZE / 2;
			const dy = y + 0.5 - MASK_SIZE / 2;
			data[at++] = 255;
			data[at++] = 255;
			data[at++] = 255;
			data[at++] = Math.hypot(dx, dy) < HOLE ? 0 : 255;
		}
	}
	return data;
}

export default defineSketch(({ scene, materials, geometry, textures, post, page, time }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground('#20242c');
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 100,
		position: [0, 0, 6],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#ffffff', intensity: 1.5 });
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 1 });

	// The backdrop: what the mask's hole shows.
	const backdrop = scene.createMesh({
		mesh: geometry.box({ width: 8, height: 5, depth: 0.2 }),
		material: materials.standard({ color: '#a33d3d' }),
		position: [0, 0, -1],
	});
	// A pole about three pixels wide, which the pick finds by its pixels alone.
	const pole = scene.createMesh({
		mesh: geometry.box({ width: 0.06, height: 3, depth: 0.06 }),
		material: materials.standard({ color: '#3da35d' }),
		position: [0.9, 0, 1],
	});
	// The card: a plane with a round hole cut by its mask.
	const mask = textures.fromData({ width: MASK_SIZE, height: MASK_SIZE, data: maskTexels() });
	const card = scene.createMesh({
		mesh: geometry.plane({ width: 2.4, height: 2.4 }),
		material: materials.standard({ map: mask, alphaMode: 'mask', alphaCutoff: 0.5 }),
		position: [-0.4, 0, 0.5],
	});

	/** The probe's name for a pick's target, or null for a miss. */
	function nameOf(hit: { object: unknown } | null): string | null {
		if (!hit) return null;
		if (hit.object === pole) return 'pole';
		if (hit.object === card) return 'card';
		if (hit.object === backdrop) return 'background';
		return 'other';
	}

	const probes: { name: string; point: [number, number, number]; expect: string | null }[] = [
		{ name: 'pole', point: [0.9, 0, 1], expect: 'pole' },
		{ name: 'mask', point: [-0.4, 0.8, 0.5], expect: 'card' },
		{ name: 'hole', point: [-0.4, 0, 0.5], expect: 'background' },
		// The ray through this point misses every object: the backdrop's box ends at its side.
		{ name: 'empty', point: [2.45, 1.2, 2], expect: null },
	];
	const screen = [0, 0, 0];
	let asked = false;

	return {
		onUpdate() {
			// The camera's matrices are current from the first frame on.
			if (asked || time.frame < 2) return;
			asked = true;
			const points = probes.map((probe) => {
				camera.worldToScreen(probe.point, screen);
				return { ...probe, x: screen[0] as number, y: screen[1] as number };
			});
			void (async () => {
				const answers: { name: string; expect: string | null; got: string | null }[] = [];
				const rays: { name: string; got: string | null }[] = [];
				const ray = { origin: [0, 0, 0], direction: [0, 0, 0] };
				const rayHit = {
					object: null,
					instance: -1,
					point: [0, 0, 0],
					normal: [0, 0, 0],
					distance: 0,
					triangle: -1,
					uv: null,
				};
				for (const probe of points) {
					let hit: { object: unknown } | null = null;
					try {
						hit = await Promise.race([
							scene.pick(probe.x, probe.y),
							new Promise<never>((_, reject) =>
								setTimeout(() => reject(new Error('pick timed out')), 15_000),
							),
						]);
					} catch (error) {
						answers.push({
							name: probe.name,
							expect: probe.expect,
							got: `error: ${error instanceof Error ? error.message : String(error)}`,
						});
						continue;
					}
					answers.push({ name: probe.name, expect: probe.expect, got: nameOf(hit) });
					camera.screenToRay(probe.x, probe.y, ray);
					rays.push({
						name: probe.name,
						got: scene.raycast(ray.origin, ray.direction, undefined, rayHit)
							? nameOf(rayHit)
							: null,
					});
				}
				// A raycast at the card's hole tests triangles only, so it hits the card. The pick
				// above answers the backdrop, which is the difference between the two.
				const raysCard = rays.find((entry) => entry.name === 'hole')?.got ?? null;
				page.post('picks', { answers, rays, raysCard });
			})();
		},
	};
});
