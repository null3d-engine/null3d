// The null3d version of S6, the city: about 19,000 objects of the generated city, from the two
// model files that the asset tool optimized, under an evening sun that casts shadows, with 32
// street lights, an environment, a sky, bloom and ambient occlusion. The camera drives the streets.
// The towers, one mesh per material, block the view with their own boxes, and many kit buildings
// with the blockers that the asset tool gave them. So occlusion culling skips what they hide: on
// the job workers on WebGL2, and on the GPU on WebGPU when the page turns it on.
//
// It loads in stages, as a large scene streams in. The setup waits for the layout and the kit file,
// creates the street nearest the camera, and returns, so the first frame comes early. Each frame
// then creates more of the kit's copies, nearest first, and the towers once their file and
// textures arrive. When the city is whole, the sketch tells the page how long each stage took. A
// held frame loads everything before it draws.
//
// The engine runs it with the quality preset that it chooses, as S4 does: the preset decides the
// shadows, ambient occlusion (High and Ultra) and software occlusion culling (Medium and up).
//
// Clicks pick buildings: a label names the picked building where the click hit it. Labels follow the
// eight tallest towers. With `?demo`, the stats overlay shows the frame's phases, and Space pauses
// and resumes the drive.
//
// The page's occlusion turns (T-36) move the camera to a share of the route, held there or driving
// on, and turn software occlusion culling on and off. The sketch answers each once a frame has it.
import {
	defineSketch,
	type Material,
	type MeshGeometry,
	type Prefab,
	type PrefabNode,
	type Vec3Like,
} from '@null3d/engine';
import { sampleEnvironment, sampleUrl } from '../../../tools/lib/sample-url';
import {
	createS6,
	S6_AO,
	S6_BACKGROUND,
	S6_BLOOM,
	S6_CAMERA,
	S6_ENVIRONMENT_INTENSITY,
	S6_LABEL_RISE,
	S6_MESSAGES,
	S6_PICK_RISE,
	S6_PICKED_LABEL,
	S6_SKY,
	S6_SUN_POSITION,
	S6_VIEW_LIGHTS,
	type S6Data,
	type S6Layout,
	s6BuildingAt,
	s6Camera,
	s6LabelId,
	s6LoopSeconds,
	s6PartTransform,
} from '../../scenes/s6';
import { loadedBytes, S6_KIT_URL, S6_TOWERS_URL } from '../lib/s6-city';
import { followPath, readCount, readGovernor, watchQuality } from './sketch-common';

/** Objects that a frame creates at most while the city streams in. */
const CREATED_PER_FRAME = 3_000;

export default defineSketch(async (context) => {
	const { scene, assets, post, quality, ui, page, time, input, debug } = context;
	const params = new URL(import.meta.url).searchParams;
	const held = params.has('hold');
	const demo = params.has('demo');
	const started = performance.now();
	const seconds = () => (performance.now() - started) / 1000;

	post.set({ toneMapping: 'aces', bloom: S6_BLOOM, ao: S6_AO });
	quality.set({ governor: readGovernor(import.meta.url) });
	const reportQuality = watchQuality(context);
	scene.setBackground(S6_BACKGROUND);
	const { sun, ambient } = S6_VIEW_LIGHTS;
	scene.createDirectionalLight({ ...sun, castShadows: true });
	scene.createAmbientLight(ambient);
	const camera = scene.createPerspectiveCamera(S6_CAMERA);
	scene.setActiveCamera(camera);

	// Every file starts at once; the stages wait only for what they need.
	const layoutLoad = assets.loadJson<S6Layout>(sampleUrl('sources/city/layout/layout.json'));
	const kitLoad = assets.loadGltf(S6_KIT_URL);
	const towersLoad = assets.loadGltf(S6_TOWERS_URL);
	const environmentLoad = assets.loadEnvironment(
		sampleEnvironment(
			sampleUrl(
				'sources/hdri/polyhaven/kloofendal_48d_partly_cloudy_puresky/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
			),
		),
	);
	const sky = { sky: { sunPosition: S6_SUN_POSITION, ...S6_SKY } };
	const environmentReady = environmentLoad.then((environment) => {
		scene.setEnvironment(environment, { intensity: S6_ENVIRONMENT_INTENSITY });
		scene.setBackground(sky);
	});

	const data = createS6(await layoutLoad, readCount(import.meta.url) || undefined);
	for (const light of data.lights) scene.createPointLight(light);
	const kit = await kitLoad;
	const kitSeconds = seconds();
	const moveCamera = followPath(camera, (t, position, target) =>
		s6Camera(data, t, position, target),
	);
	moveCamera(0);

	// The labels on the tallest towers, and the one that names a picked building, which a marker
	// carries to the point where the click hit.
	const towerTops = new Map<number, ((typeof data.labels)[number] & { id: string })[]>();
	data.labels.forEach((label, k) => {
		const material = data.material[label.row] as number;
		towerTops.set(material, [...(towerTops.get(material) ?? []), { ...label, id: s6LabelId(k) }]);
	});
	page.post(S6_MESSAGES.labels, [
		...data.labels.map((label, k) => ({ id: s6LabelId(k), text: label.text })),
		{ id: S6_PICKED_LABEL, text: '' },
	]);
	const marker = scene.createGroup({ dynamic: true });
	ui.trackLabel(marker, S6_PICKED_LABEL);
	const pick = (building: number, point: Vec3Like) => {
		marker.setPosition(point[0] as number, (point[1] as number) + S6_PICK_RISE, point[2] as number);
		page.post(S6_MESSAGES.picked, building);
	};

	const kitParts = kitPartsOf(kit, data);
	const position: [number, number, number] = [0, 0, 0];
	const rotation: [number, number, number, number] = [0, 0, 0, 1];
	const scale: [number, number, number] = [1, 1, 1];
	/** Creates one object for each part of a kit row's model. */
	const createKitRow = (row: number) => {
		const model = data.model[row] as number;
		const building = data.building[row] as number;
		for (const part of kitParts[model] ?? []) {
			s6PartTransform(
				data,
				row,
				part.position,
				part.rotation,
				part.scale,
				position,
				rotation,
				scale,
			);
			const mesh = scene.createMesh({
				mesh: part.mesh,
				material: part.material,
				position,
				rotation,
				scale,
				castShadows: true,
				receiveShadows: true,
				occluder: part.occluder,
			});
			if (building >= 0) mesh.on('click', (event) => pick(building, event.point));
		}
	};
	/** Creates the mesh of a material's boxes from the tower file. */
	let towers: Prefab | undefined;
	const createTower = (material: number) => {
		const node = (towers as Prefab).find(`t${material}`) as PrefabNode;
		const mesh = scene.createMesh({
			mesh: node.mesh as MeshGeometry,
			material: node.material as Material,
			position: node.position,
			rotation: node.rotation,
			scale: node.scale,
			castShadows: true,
			receiveShadows: true,
			occluder: node.occluder,
		});
		mesh.on('click', (event) => {
			const building = s6BuildingAt(data, material, event.point);
			if (building >= 0) pick(building, event.point);
		});
		// A label's offset is in the object's own space, whose origin and scale the asset tool
		// moved to fit the mesh's stored positions.
		const [tx, ty, tz] = node.position;
		const [sx, sy, sz] = node.scale;
		for (const label of towerTops.get(material) ?? []) {
			const row = label.row;
			ui.trackLabel(mesh, label.id, {
				offset: [
					((data.position[row * 3] as number) - tx) / sx,
					((data.position[row * 3 + 1] as number) + label.height + S6_LABEL_RISE - ty) / sy,
					((data.position[row * 3 + 2] as number) - tz) / sz,
				],
			});
		}
	};

	// The stages: the kit's copies in turns, nearest first, then the towers in turns once their
	// file is in. A held frame creates everything now.
	let nextKit = 0;
	let nextTower = 0;
	let towersSeconds = 0;
	let loaded = false;
	towersLoad.then((prefab) => {
		towers = prefab;
		towersSeconds = seconds();
	});
	const stream = (budget: number) => {
		let made = 0;
		while (nextKit < data.kitOrder.length && made < budget) {
			createKitRow(data.kitOrder[nextKit++] as number);
			made++;
		}
		while (towers && nextTower < data.towerOrder.length && made < budget) {
			createTower(data.towerOrder[nextTower++] as number);
			made++;
		}
		if (loaded || !towers || nextTower < data.towerOrder.length || nextKit < data.kitOrder.length)
			return;
		loaded = true;
		environmentReady.then(() =>
			page.post(S6_MESSAGES.loaded, {
				kit: kitSeconds,
				towers: towersSeconds,
				whole: seconds(),
				objects: data.count,
				bytes: loadedBytes(),
			}),
		);
	};
	if (held) {
		towers = await towersLoad;
		towersSeconds = seconds();
		await environmentReady;
		stream(Number.POSITIVE_INFINITY);
	} else {
		stream(CREATED_PER_FRAME);
	}

	let paused = false;
	let drive = 0;
	if (demo) debug.stats(true);
	// The occlusion turns' camera: a move that the next frame makes, the seconds it adds to the
	// clock's, or a held route time, and whether the next frame answers the page.
	let move: { share: number; still: boolean } | undefined;
	let offset = 0;
	let heldAt: number | undefined;
	let answer = false;
	page.onMessage((type, message) => {
		if (type === S6_MESSAGES.drive) move = message as typeof move;
		else if (type === S6_MESSAGES.occlusion) quality.set({ softwareOcclusion: message === true });
		else return;
		answer = true;
	});
	return {
		onUpdate() {
			if (!loaded) stream(CREATED_PER_FRAME);
			if (demo) {
				if (input.wasPressed('Space')) paused = !paused;
				if (!paused) drive += time.dt;
				moveCamera(drive);
			} else {
				if (move) {
					const at = move.share * s6LoopSeconds(data);
					heldAt = move.still ? at : undefined;
					offset = at - time.now;
					move = undefined;
				}
				moveCamera(heldAt ?? time.now + offset);
			}
			reportQuality();
			if (answer) {
				answer = false;
				page.post(S6_MESSAGES.done, time.frame);
			}
		},
	};
});

/** A part of a kit model: its mesh and material, its place in the model, and whether it blocks. */
interface KitPart {
	mesh: MeshGeometry;
	material: Material;
	position: readonly number[];
	rotation: readonly number[];
	scale: readonly number[];
	occluder: boolean;
}

/** The parts of each kit model that the layout uses, from the kit file's nodes. */
function kitPartsOf(kit: Prefab, data: S6Data): KitPart[][] {
	const parts: KitPart[][] = [];
	const models = new Set<number>();
	for (const row of data.kitOrder) models.add(data.model[row] as number);
	for (const model of models) {
		const list: KitPart[] = [];
		for (let k = 0; ; k++) {
			const node = kit.find(`k${model}-${k}`);
			if (!node) break;
			list.push({
				mesh: node.mesh as MeshGeometry,
				material: node.material as Material,
				position: node.position,
				rotation: node.rotation,
				scale: node.scale,
				occluder: node.occluder,
			});
		}
		if (list.length === 0) throw new Error(`S6's kit file has no parts of model ${model}`);
		parts[model] = list;
	}
	return parts;
}
