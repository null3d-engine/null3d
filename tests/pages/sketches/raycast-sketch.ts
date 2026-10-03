// The same scene in null3D and in three.js, and seeded rays through both: the raycasts must give
// three.js's Raycaster's hits. The scene has every generator shape, rotated and scaled objects,
// mirrored ones, a child under a turned group, double-sided materials, hidden objects, objects on
// other layers, a static and a dynamic instance batch, and a sphere of more than 65,535 vertices,
// which WebGL2 stores in several parts. The sketch also checks that each hit's point lies on the
// objects that overlap queries find there, and that a batch of 10,000 rays on the job workers
// gives each ray's own raycast. On 'results' it posts what it found, once the scene has had two
// frames. On 'batches' it casts a batch of 10,000 rays in every frame, until 'stop'.
import {
	defineSketch,
	type InstanceBatch,
	type Material,
	type MeshGeometry,
	type Object3D,
	type OverlapHit,
	type RaycastHit,
	type RaycastOptions,
} from '@null3d/engine';
import {
	BoxGeometry,
	type BufferGeometry,
	ConeGeometry,
	CylinderGeometry,
	DoubleSide,
	FrontSide,
	Group,
	InstancedMesh,
	type Intersection,
	Matrix3,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	Quaternion,
	Raycaster,
	SphereGeometry,
	type Object3D as ThreeObject,
	Scene as ThreeScene,
	TorusGeometry,
	Vector3,
} from 'three';
import type { RaycastResults } from '../lib/raycast';

/** Rays in each batch. */
const BATCH_RAYS = 10_000;
/** Distances and points may differ by this much: 32-bit floats against three.js's 64-bit. */
const TOLERANCE = 2e-4;

/** A small seeded generator, so every run casts the same rays. */
function generator(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export default defineSketch(({ scene, geometry, materials, page }) => {
	const random = generator(7);
	const range = (lo: number, hi: number) => lo + (hi - lo) * random();
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		position: [0, 10, 45],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ intensity: 1 });

	const three = new ThreeScene();
	/** Each null3D object or batch, and the three.js object that stands for it. */
	const twins = new Map<Object3D | InstanceBatch, ThreeObject>();
	const front = materials.standard({ color: '#c0c0c0' });
	const both = materials.standard({ color: '#c08040', doubleSided: true });
	const threeFront = new MeshBasicMaterial({ side: FrontSide });
	const threeBoth = new MeshBasicMaterial({ side: DoubleSide });
	const shapes: [MeshGeometry, BufferGeometry][] = [
		[geometry.box({ width: 1.5, height: 1, depth: 2 }), new BoxGeometry(1.5, 1, 2)],
		[geometry.sphere({ radius: 1 }), new SphereGeometry(1)],
		[
			geometry.torus({ radius: 1, tube: 0.35, radialSegments: 10, tubularSegments: 28 }),
			new TorusGeometry(1, 0.35, 10, 28),
		],
		[geometry.plane({ width: 3, height: 2 }), new PlaneGeometry(3, 2)],
		[
			geometry.cylinder({ radiusTop: 0.6, radiusBottom: 0.9, height: 2, radialSegments: 20 }),
			new CylinderGeometry(0.6, 0.9, 2, 20),
		],
		[geometry.cone({ radius: 1, height: 1.5 }), new ConeGeometry(1, 1.5)],
	];
	const randomRotation = (): [number, number, number, number] => {
		const q = new Quaternion(range(-1, 1), range(-1, 1), range(-1, 1), range(-1, 1)).normalize();
		return [q.x, q.y, q.z, q.w];
	};
	const place = (twin: ThreeObject, p: number[], q: number[], s: number[]) => {
		twin.position.fromArray(p);
		twin.quaternion.fromArray(q);
		twin.scale.fromArray(s);
	};
	/** Creates one object in both scenes. */
	const add = (
		k: number,
		material: Material,
		options: {
			position: [number, number, number];
			rotation: [number, number, number, number];
			scale: [number, number, number];
			layers: number;
			dynamic?: boolean;
			parent?: Object3D;
		},
	) => {
		const [mesh, shape] = shapes[k % shapes.length] as [MeshGeometry, BufferGeometry];
		const object = scene.createMesh({ mesh, material, ...options });
		const twin = new Mesh(shape, material === both ? threeBoth : threeFront);
		place(twin, options.position, options.rotation, options.scale);
		twin.layers.mask = options.layers;
		const parent = options.parent ? twins.get(options.parent) : three;
		parent?.add(twin);
		twins.set(object, twin);
		return object;
	};
	const layerChoices = [1, 1, 1, 2, 3];
	for (let k = 0; k < 60; k++) {
		const mirrored = k % 9 === 4 ? -1 : 1;
		const object = add(k, k % 4 === 3 ? both : front, {
			position: [range(-20, 20), range(-8, 8), range(-20, 20)],
			rotation: randomRotation(),
			scale: [mirrored * range(0.5, 2.5), range(0.5, 2.5), range(0.5, 2.5)],
			layers: layerChoices[k % layerChoices.length] as number,
			dynamic: k % 5 === 0,
		});
		// Hidden objects are never hit; three.js's Raycaster tests them, so its scene drops them.
		if (k % 13 === 6) {
			object.setVisible(false);
			twins.get(object)?.removeFromParent();
			twins.delete(object);
		}
	}
	// A child under a turned and scaled group.
	const turn = randomRotation();
	const group = scene.createGroup({ position: [5, 3, -4], rotation: turn, scale: [2, 1, 1.5] });
	const threeGroup = new Group();
	place(threeGroup, [5, 3, -4], turn, [2, 1, 1.5]);
	three.add(threeGroup);
	twins.set(group, threeGroup);
	add(1, front, {
		position: [1, 0.5, 0],
		rotation: randomRotation(),
		scale: [1, 1, 1],
		layers: 1,
		parent: group,
	});
	twins.delete(group);
	// A sphere of 321 × 221 vertices, more than one WebGL2 page holds.
	const big = geometry.sphere({ radius: 6, widthSegments: 320, heightSegments: 220 });
	const bigObject = scene.createMesh({ mesh: big, material: front, position: [0, -25, 0] });
	const bigTwin = new Mesh(new SphereGeometry(6, 320, 220), threeFront);
	bigTwin.position.set(0, -25, 0);
	three.add(bigTwin);
	twins.set(bigObject, bigTwin);
	// A static batch of boxes and a dynamic batch of spheres.
	for (const [k, dynamic, count] of [
		[0, false, 40],
		[1, true, 30],
	] as const) {
		const [mesh, shape] = shapes[k] as [MeshGeometry, BufferGeometry];
		const batch = scene.createInstances(mesh, count, { material: front, dynamic });
		const twin = new InstancedMesh(shape, threeFront, count);
		const m = new Matrix4();
		for (let r = 0; r < count; r++) {
			const p = [range(-25, 25), range(-10, 10), range(-25, 25)];
			const q = randomRotation();
			const s = [range(0.5, 2), range(0.5, 2), range(0.5, 2)];
			batch.positions.set(p, r * 3);
			batch.rotations.set(q, r * 4);
			batch.scales.set(s, r * 3);
			twin.setMatrixAt(r, m.compose(new Vector3(...p), new Quaternion(...q), new Vector3(...s)));
		}
		if (!dynamic) batch.markDirty();
		twin.computeBoundingSphere();
		three.add(twin);
		twins.set(batch, twin);
	}
	three.updateMatrixWorld(true);

	const raycaster = new Raycaster();
	const origin = new Vector3();
	const direction = new Vector3();
	const objects = [...twins.values()];
	const twinOf = (object: Object3D | InstanceBatch | null) =>
		object ? twins.get(object) : undefined;
	const normalMatrix = new Matrix3();
	/** three.js's hit's triangle normal in world space, facing the ray, as null3D gives it. */
	const worldNormal = (hit: Intersection) => {
		const n = (hit.face?.normal ?? new Vector3()).clone();
		normalMatrix.getNormalMatrix(hit.object.matrixWorld);
		n.applyMatrix3(normalMatrix).normalize();
		if (n.dot(raycaster.ray.direction) > 0) n.negate();
		return n;
	};
	const describe = (object: Object3D | InstanceBatch | null, instance: number) => {
		const twin = twinOf(object);
		return `${twin ? objects.indexOf(twin) : 'none'}${instance >= 0 ? `#${instance}` : ''}`;
	};
	const describeThree = (hit: Intersection | undefined) =>
		hit
			? `${objects.indexOf(hit.object)}${hit.instanceId !== undefined ? `#${hit.instanceId}` : ''}`
			: 'none';
	const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(b));

	/** A seeded ray: toward a random object, or in a random direction. */
	const newRay = () => {
		const o = [range(-35, 35), range(-30, 20), range(-35, 35)];
		let d: number[];
		if (random() < 0.7) {
			const target = objects[Math.floor(random() * objects.length)] as ThreeObject;
			const at = new Vector3();
			if (target instanceof InstancedMesh) {
				const m = new Matrix4();
				target.getMatrixAt(Math.floor(random() * target.count), m);
				at.setFromMatrixPosition(m);
			} else target.getWorldPosition(at);
			d = [at.x - o[0]! + range(-1, 1), at.y - o[1]! + range(-1, 1), at.z - o[2]! + range(-1, 1)];
		} else d = [range(-1, 1), range(-1, 1), range(-1, 1)];
		return [...o, ...d];
	};

	const results: RaycastResults = {
		rays: 0,
		closestHits: 0,
		allHits: 0,
		mismatches: 0,
		examples: [],
		overlapChecks: 0,
		overlapMisses: 0,
		batchRays: BATCH_RAYS,
		batchHits: 0,
		batchMismatches: 0,
	};
	const mismatch = (text: string) => {
		results.mismatches++;
		if (results.examples.length < 12) results.examples.push(text);
	};
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: [0, 0, 0],
		normal: [0, 0, 0],
		distance: 0,
		triangle: -1,
	};
	const hits: RaycastHit[] = [];
	const found: OverlapHit[] = [];

	/** Casts one ray through both scenes and records how they differ. */
	const compare = (ray: number[], r: number) => {
		const mask = [1, 2, 3, 0xffffffff][r % 4] as number;
		const maxDistance = r % 5 === 2 ? range(5, 40) : undefined;
		const options: RaycastOptions = { layers: mask, maxDistance };
		origin.fromArray(ray, 0);
		direction.fromArray(ray, 3).normalize();
		raycaster.set(origin, direction);
		raycaster.far = maxDistance ?? Infinity;
		raycaster.layers.mask = mask;
		const want = raycaster.intersectObjects(objects, false);
		const o = ray.slice(0, 3);
		const d = ray.slice(3);
		const got = scene.raycast(o, d, options, hit);
		results.rays++;
		const first = want[0];
		if (scene.raycastAny(o, d, options) !== want.length > 0)
			mismatch(`ray ${r}: raycastAny ${!got}, three.js ${want.length} hits`);
		if (got !== (first !== undefined)) {
			mismatch(
				`ray ${r}: null3D ${describe(hit.object, hit.instance)}, three.js ${describeThree(first)}`,
			);
			return;
		}
		if (first) {
			results.closestHits++;
			const same = twinOf(hit.object) === first.object && (first.instanceId ?? -1) === hit.instance;
			if (!same && !near(hit.distance, first.distance))
				mismatch(
					`ray ${r}: closest ${describe(hit.object, hit.instance)} at ${hit.distance}, three.js ${describeThree(first)} at ${first.distance}`,
				);
			else if (same) {
				const n = worldNormal(first);
				const p = first.point;
				if (
					!near(hit.distance, first.distance) ||
					hit.triangle !== first.faceIndex ||
					![p.x, p.y, p.z].every((v, k) => near(hit.point[k] as number, v)) ||
					![n.x, n.y, n.z].every((v, k) => Math.abs((hit.normal[k] as number) - v) < 1e-3)
				)
					mismatch(
						`ray ${r}: ${describeThree(first)} distance ${hit.distance} / ${first.distance}, triangle ${hit.triangle} / ${first.faceIndex}, point ${[...(hit.point as number[])]} / ${p.toArray()}, normal ${[...(hit.normal as number[])]} / ${n.toArray()}`,
					);
			}
			// Overlap queries at the hit's point find the hit object.
			const isThere = (count: number) =>
				found.slice(0, count).some((f) => f.object === hit.object && f.instance === hit.instance);
			results.overlapChecks++;
			if (!isThere(scene.overlapSphere(hit.point, 1e-3, { layers: mask }, found)))
				results.overlapMisses++;
			const p = hit.point as number[];
			const low = p.map((v) => v - 1e-3);
			const high = p.map((v) => v + 1e-3);
			if (!isThere(scene.overlapBox(low, high, { layers: mask }, found))) results.overlapMisses++;
		}
		// Every hit, as triangle keys with their distances.
		const count = scene.raycastAll(o, d, options, hits);
		results.allHits += count;
		const key = (twin: ThreeObject | undefined, instance: number, triangle: number) =>
			`${twin ? objects.indexOf(twin) : 'none'}/${instance}/${triangle}`;
		const mine = new Map(
			hits.slice(0, count).map((h) => [key(twinOf(h.object), h.instance, h.triangle), h.distance]),
		);
		const theirs = new Map(
			want.map((h) => [key(h.object, h.instanceId ?? -1, h.faceIndex ?? -1), h.distance]),
		);
		for (const [k, distance] of theirs)
			if (!mine.has(k) || !near(mine.get(k) as number, distance))
				mismatch(`ray ${r}: raycastAll lacks ${k} at ${distance}`);
		for (const k of mine.keys()) if (!theirs.has(k)) mismatch(`ray ${r}: raycastAll adds ${k}`);
		for (let k = 1; k < count; k++)
			if ((hits[k] as RaycastHit).distance < (hits[k - 1] as RaycastHit).distance)
				mismatch(`ray ${r}: raycastAll is not nearest first`);
	};

	const batchRays = new Float64Array(BATCH_RAYS * 6);
	const batchOut = {
		distances: new Float32Array(BATCH_RAYS),
		objects: new Array<Object3D | InstanceBatch | null>(BATCH_RAYS).fill(null),
		instances: new Int32Array(BATCH_RAYS),
	};
	for (let i = 0; i < BATCH_RAYS; i++) batchRays.set(newRay(), i * 6);
	const allLayers: RaycastOptions = { layers: 0xffffffff };

	let frame = 0;
	let asked = false;
	let batches = false;
	let done = false;
	page.onMessage((name) => {
		if (name === 'results') asked = true;
		if (name === 'batches') batches = true;
		if (name === 'stop') batches = false;
	});
	return {
		onLateUpdate() {
			frame++;
			// By the second frame, every object and the batches' rows have their places.
			if (frame === 2) {
				for (let r = 0; r < 600; r++) compare(newRay(), r);
				results.batchHits = scene.raycastBatch(batchRays, allLayers, batchOut);
				for (let i = 0; i < BATCH_RAYS; i++) {
					const ray = batchRays.subarray(i * 6, i * 6 + 6);
					const one = scene.raycast(ray.subarray(0, 3), ray.subarray(3), allLayers, hit);
					const distance = one ? Math.fround(hit.distance) : -1;
					if (
						batchOut.distances[i] !== distance ||
						batchOut.objects[i] !== (one ? hit.object : null) ||
						batchOut.instances[i] !== (one ? hit.instance : -1)
					)
						results.batchMismatches++;
				}
				done = true;
			}
			if (done && asked) {
				asked = false;
				page.post('results', results);
			}
			if (batches) scene.raycastBatch(batchRays, allLayers, batchOut);
		},
	};
});
