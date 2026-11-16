// A proof sketch for Skyway's chase camera: the hero car hovers just past a tower's corner, with
// the chase camera behind it, inside the tower. The camera must not let the tower hide the car; it
// pulls in before the corner instead. ?t= gives the seconds the chase camera has to settle, and
// ?quiet= leaves out the tower, for a frame that shows the car alone. ?run=turn flies the car along
// a face and turns it away, so the camera swings past the tower. The strip spec draws the frames
// for the owner's look; they are not references.
import { defineSketch, quat } from '@null3d/engine';
import { CAMERA_LAYERS } from '../../../examples/lib/layers';
import { cityTowers } from '../../../examples/showcase/skyway/drive';
import { createHero } from '../../../examples/showcase/skyway/hero';

const params = new URL(import.meta.url).searchParams;
/** How long the chase camera eases after the car before the frame, in seconds. */
const SETTLE = Number(params.get('t') ?? 2);
/** The car's height in the proof, below the tower's roof. */
const HEIGHT = 40;
/**
 * Which proof to draw: `corner` hovers the car beside a tower, where the camera must pull in at
 * once; `turn` flies the car along a face and turns away, so the camera swings past the tower.
 */
const RUN = params.get('run') ?? 'corner';
/** The frame of the turn run where the car starts to steer away from the tower. */
const STEER = 132;

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, quality, assets } = ctx;
	await quality.set({ governor: false });
	scene.setBackground('#0b0e14');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.6 });
	scene.createDirectionalLight({
		direction: [-0.5, -0.7, -0.45],
		color: '#ffe6c8',
		intensity: 3.2,
	});
	// The central tower of the city's plan, the one the car hovers beside. Its box is the five
	// numbers that the flight reads: centre x and z, half width and half depth, and the top.
	const all = cityTowers();
	let at = 0;
	let nearest = Number.POSITIVE_INFINITY;
	for (let k = 0; k < all.length; k += 5) {
		const away = Math.abs(all[k] as number) + Math.abs(all[k + 1] as number);
		if (away < nearest) {
			nearest = away;
			at = k;
		}
	}
	const cx = all[at] as number;
	const cz = all[at + 1] as number;
	const hx = all[at + 2] as number;
	const hz = all[at + 3] as number;
	const top = all[at + 4] as number;
	// The control frame shows the camera at rest: the tower is left out of the drawing, and also
	// out of the camera's tower list, or an unseen tower would still pull the camera in.
	const quiet = params.has('quiet');
	const towers = new Float32Array(quiet ? all.length - 5 : all.length);
	if (quiet) {
		towers.set(all.subarray(0, at), 0);
		towers.set(all.subarray(at + 5), at);
	} else towers.set(all);
	// The ground and the tower, in plain materials, so the car's neon band stands out from them.
	const flat = quat.create();
	quat.fromEuler(flat, -Math.PI / 2, 0, 0);
	scene.createMesh({
		mesh: geometry.plane({ width: 600, height: 600 }),
		material: materials.standard({ color: '#1c2026', roughness: 0.9 }),
		position: [cx, 0, cz],
		rotation: [flat[0] as number, flat[1] as number, flat[2] as number, flat[3] as number],
	});
	if (!quiet)
		scene.createMesh({
			mesh: geometry.box({ width: 2 * hx, height: top, depth: 2 * hz }),
			material: materials.standard({ color: '#3a4048', roughness: 0.9 }),
			position: [cx, top / 2, cz],
		});
	// The car just past the tower's +x face, at its +z corner, facing away along +x. The chase
	// camera sits 12.9 m behind it, inside the tower's box, and must pull in before the corner.
	// The turn run starts the car south of the face and flies it north, then turns it away.
	const place: [number, number, number] =
		RUN === 'turn' ? [cx + hx + 3.1, HEIGHT, cz - 40] : [cx + hx + 3.1, HEIGHT, cz + hz - 2];
	const start =
		RUN === 'turn'
			? {
					position: [place[0], place[1] + 5.2, place[2] - 26] as [number, number, number],
					target: [place[0], place[1] + 5.2, place[2] - 25] as [number, number, number],
				}
			: {
					position: [place[0] - 26, place[1] + 5.2, place[2]] as [number, number, number],
					target: [place[0] - 25, place[1] + 5.2, place[2]] as [number, number, number],
				};
	const camera = scene.createPerspectiveCamera({
		fov: 58,
		near: 0.1,
		far: 1000,
		position:
			RUN === 'turn'
				? [place[0], place[1] + 4.35, place[2] - 12.88]
				: [place[0] - 12.88, place[1] + 4.35, place[2]],
		target: [place[0], place[1], place[2]],
	});
	// The hero car draws on the showcase scenes' effect layer, so the camera must draw it.
	camera.setLayers(CAMERA_LAYERS);
	scene.setActiveCamera(camera);
	const hero = createHero(ctx, camera, start, place, towers);
	hero.take();
	for (let frame = 0; frame < Math.round(SETTLE * 60); frame++)
		hero.drive(1 / 60, (code) =>
			RUN === 'turn' ? code === 'KeyW' || (code === 'KeyD' && frame >= STEER) : false,
		);
	// The strip reads the camera's distance from the car, so a reviewer can read the approach
	// rather than infer it from how large the car looks. The distance is taken here, while the
	// engine still runs: the image page stops the engine after it captures the frame.
	const eye: [number, number, number] = [0, 0, 0];
	const car: [number, number, number] = [0, 0, 0];
	camera.getPosition(eye);
	hero.group.getPosition(car);
	const distance = Math.hypot(eye[0] - car[0], eye[1] - car[1], eye[2] - car[2]);
	(globalThis as unknown as { sightDistance?: number }).sightDistance = distance;
});
