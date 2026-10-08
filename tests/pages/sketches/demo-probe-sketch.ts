// Runs one of the demos in examples/ live, and reports where its camera and its moving objects are,
// so that a test can drive the pointer and see the camera or a steered object move. ?demo= names
// the demo's sketch module from the server's root. The sketch answers the page's 'probe' message
// with a 'probe' message: the active camera's place in the world, and the world places of the
// demo's dynamic meshes and lights, in the order the demo made them.
import {
	type Camera,
	defineSketch,
	type Object3D,
	type Scene,
	type SketchDefinition,
} from '@null3d/engine';
import type { DemoProbe } from '../lib/demo-probe';
import { withMembers } from '../lib/with-members';

const demoPath = new URL(import.meta.url).searchParams.get('demo');
if (!demoPath?.startsWith('/'))
	throw new Error('Add ?demo= with the path of a demo sketch module from the server root.');
const inner = (
	(await import(/* @vite-ignore */ new URL(demoPath, import.meta.url).href)) as {
		default: SketchDefinition;
	}
).default;

export default defineSketch(async (context) => {
	const { scene, page } = context;
	let camera: Camera | undefined;
	const moving: Object3D[] = [];
	/** Keeps an object that the demo made dynamic, the kind that it moves. */
	const keep = <T extends Object3D>(object: T, options: { dynamic?: boolean }): T => {
		if (options.dynamic) moving.push(object);
		return object;
	};
	const members: Partial<Scene> = {
		setActiveCamera(active: Camera) {
			camera = active;
			scene.setActiveCamera(active);
		},
		createMesh: (options: Parameters<Scene['createMesh']>[0]) =>
			keep(scene.createMesh(options), options),
		createPointLight: (options: Parameters<Scene['createPointLight']>[0]) =>
			keep(scene.createPointLight(options), options),
	};
	const callbacks =
		(await inner.setup(withMembers(context, { scene: withMembers(scene, members) }))) ?? {};
	const at = new Float64Array(3);
	const place = (object: Object3D) => {
		object.getWorldPosition(at);
		return [...at];
	};
	page.onMessage((name) => {
		if (name !== 'probe') return;
		const probe: DemoProbe = {
			camera: camera ? place(camera) : [],
			objects: moving.map(place),
		};
		page.post('probe', probe);
	});
	return callbacks;
}, inner.options);
