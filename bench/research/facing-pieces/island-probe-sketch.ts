// Temporary measuring sketch: the Island with its camera held at a pose that the page posts, and
// every object and instance batch grouped by the mesh it draws, so the page can hide one mesh's
// copies at a time and read what they draw. Not kept in the repository.
import { defineSketch } from '@null3d/engine';
import island from '../../../examples/showcase/island/sketch';

/** One mesh's copies: the batches and the objects that draw it. */
interface Group {
	label: string;
	triangles: number;
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	batches: { batch: any; count: number }[];
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	objects: any[];
	copies: number;
}

/** The function that called the scene, from a stack, for a label. */
function caller(): string {
	const lines = (new Error().stack ?? '').split('\n').slice(3, 6);
	return lines
		.map((line) =>
			line
				.trim()
				.replace(/^at /, '')
				.replace(/ \(.*$/, ''),
		)
		.join(' < ');
}

export default defineSketch(async (ctx) => {
	const pose = [-92, 36, 360, -92, 26, 200];
	const groups = new Map<unknown, Group>();
	const triangles = new Map<unknown, number>();
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	let sun: any;
	let pending: { name: string; frames: number } | undefined;
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	const geometry = ctx.geometry as any;
	const fromArrays = geometry.fromArrays.bind(geometry);
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	geometry.fromArrays = (arrays: any) => {
		const mesh = fromArrays(arrays);
		const count = arrays.indices ? arrays.indices.length / 3 : arrays.positions.length / 9;
		triangles.set(mesh, count);
		return mesh;
	};
	const group = (mesh: unknown): Group => {
		let found = groups.get(mesh);
		if (!found) {
			found = {
				label: caller(),
				triangles: triangles.get(mesh) ?? -1,
				batches: [],
				objects: [],
				copies: 0,
			};
			groups.set(mesh, found);
		}
		return found;
	};
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	const scene = ctx.scene as any;
	const create = scene.createPerspectiveCamera.bind(scene);
	scene.createPerspectiveCamera = (options: unknown) => {
		const camera = create(options);
		const setPosition = camera.setPosition.bind(camera);
		const lookAt = camera.lookAt.bind(camera);
		camera.setPosition = () => setPosition(pose[0], pose[1], pose[2]);
		camera.lookAt = () => lookAt(pose[3], pose[4], pose[5]);
		return camera;
	};
	const light = scene.createDirectionalLight.bind(scene);
	scene.createDirectionalLight = (options: unknown) => {
		const made = light(options);
		sun ??= made;
		return made;
	};
	const instances = scene.createInstances.bind(scene);
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	scene.createInstances = (mesh: any, count: number, options: any) => {
		const batch = instances(mesh, count, options);
		const g = group(mesh);
		g.batches.push({ batch, count });
		g.copies += count;
		return batch;
	};
	const meshes = scene.createMesh.bind(scene);
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	scene.createMesh = (options: any) => {
		const made = meshes(options);
		const g = group(options?.mesh);
		g.objects.push(made);
		g.copies += 1;
		return made;
	};
	const list = () => [...groups.values()];
	const show = (g: Group, visible: boolean) => {
		for (const { batch, count } of g.batches) batch.setActiveCount(visible ? count : 0);
		for (const object of g.objects) object.setVisible(visible);
	};
	ctx.page.onMessage((name, data) => {
		if (name === 'pose') pose.splice(0, 6, ...(data as number[]));
		if (name === 'list')
			ctx.page.post(
				'groups',
				list().map((g, index) => ({
					index,
					label: g.label,
					triangles: g.triangles,
					copies: g.copies,
					batches: g.batches.length,
					objects: g.objects.length,
				})),
			);
		if (name === 'hide' || name === 'show') {
			for (const index of data as number[]) {
				const g = list()[index];
				if (g) show(g, name === 'show');
			}
			pending = { name: `${name}n`, frames: 4 };
		}
		if (name === 'shadows') {
			sun?.setCastShadows(data as boolean);
			pending = { name: 'shadowsn', frames: 4 };
		}
	});
	ctx.debug.frameStats();
	const callbacks = await island.setup(ctx);
	ctx.quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	return {
		...callbacks,
		onUpdate(...args: unknown[]) {
			// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
			(callbacks as any)?.onUpdate?.(...args);
			if (pending && --pending.frames <= 0) {
				ctx.page.post(pending.name, true);
				pending = undefined;
			}
		},
	};
}, island.options);
