// The development build's inspection channel: the calls that the in-page inspector and the MCP
// server make through the page into the sketch worker. Each call reads or changes the running scene,
// returns a JSON-safe value, and runs between frames. A release build holds none of it: the sketch
// worker and the page start the channel only under the development flag.
//
// The scene's objects are named by their slot, `#<slot>`, or by their name, which `scene.find` takes.
// A change is applied at once with the scene's setters, which queue their commands for the next
// frame; the answer describes the object as the calls left it.

import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { QualityPreset, QualitySettings } from '../quality/presets';
import type { Render } from '../scene/render';
import type { MaterialOptions } from '../scene/resources';
import {
	AmbientLight,
	Camera,
	DirectionalLight,
	Group,
	HemisphereLight,
	Light,
	Mesh,
	type Object3D,
	OrthographicCamera,
	PerspectiveCamera,
	PointLight,
	PrefabInstance,
	RectAreaLight,
	type Scene,
	SpotLight,
	TubeLight,
} from '../scene/scene';
import type { SketchQuality } from '../sketch/quality';
import type { Debug } from './debug';
import type { DebugDraw } from './draw';
import type { FrameStats } from './stats';

/** The calls that the inspection channel takes. */
export type InspectCall =
	| 'objects'
	| 'object'
	| 'setObject'
	| 'setMaterial'
	| 'stats'
	| 'errors'
	| 'graph'
	| 'setQuality'
	| 'highlight'
	| 'info';

/** A request from the page or the inspector to the channel. */
export interface InspectRequest {
	call: string;
	args?: unknown;
}

/** The channel's answer: the value of the call, or why it failed. */
export type InspectReply = { ok: true; result: unknown } | { ok: false; error: string };

/** What a scene object looks like in a listing. */
export interface ObjectSummary {
	/** The object's slot in the scene, or its handle with the generation bits. */
	slot: number;
	handle: number;
	name: string;
	kind: string;
	dynamic: boolean;
	visible: boolean;
	layers: number;
	/** The slot of the object's live parent, or null for a root. */
	parent: number | null;
	children: number;
	/** The material's id for a mesh, or absent. */
	material?: number;
}

/** A scene object with its transform and its material. */
export interface ObjectDetail extends ObjectSummary {
	position: [number, number, number];
	rotation: [number, number, number, number];
	scale: [number, number, number];
	worldPosition: [number, number, number];
	materialValues?: Record<string, unknown>;
	shading?: number;
}

/** What a call that changes a material takes. */
export interface SetMaterialArgs {
	selector: number | string;
	values: MaterialOptions & Record<string, unknown>;
}

/** What a call that changes an object takes. */
export interface SetObjectArgs {
	selector: number | string;
	position?: readonly number[];
	rotation?: readonly number[];
	/** Euler angles in radians, around X, then Y, then Z. */
	rotationEuler?: readonly number[];
	scale?: readonly number[];
	visible?: boolean;
	dynamic?: boolean;
	layers?: number;
}

/** What the channel reads the scene and the engine from. */
export interface DebugChannelHost {
	scene: Scene;
	render: Render;
	quality: SketchQuality;
	debug: Debug;
	/** The development build's debug drawing, which outlines the selected object. */
	debugDraw?: DebugDraw;
	/** The engine's tier, preset and thread mode, as the page reports them. */
	info(): Record<string, unknown>;
}

/** The most errors that the channel keeps. */
const MAX_ERRORS = 50;

/** The largest number of objects that one listing returns, unless a call asks for fewer. */
const MAX_LISTED = 50_000;

/** The kind of an object, as the inspector names it. */
function kindOf(object: Object3D): string {
	if (
		object instanceof PerspectiveCamera ||
		object instanceof OrthographicCamera ||
		object instanceof Camera
	)
		return 'camera';
	if (object instanceof SpotLight) return 'spot-light';
	if (object instanceof PointLight) return 'point-light';
	if (object instanceof DirectionalLight) return 'directional-light';
	if (object instanceof HemisphereLight) return 'hemisphere-light';
	if (object instanceof AmbientLight) return 'ambient-light';
	if (object instanceof RectAreaLight) return 'rect-area-light';
	if (object instanceof TubeLight) return 'tube-light';
	if (object instanceof Light) return 'light';
	if (object instanceof PrefabInstance) return 'prefab';
	if (object instanceof Group) return 'group';
	if (object instanceof Mesh) return 'mesh';
	return 'object';
}

/** Throws E1213 for a value that is not a record. */
function recordOf(value: unknown, what: string): Record<string, unknown> {
	if (value !== null && typeof value === 'object' && !Array.isArray(value))
		return value as Record<string, unknown>;
	throw new EngineError(
		'E1213',
		`The inspector got ${String(value)} for ${what}, which is not an object.`,
	);
}

/** Reads `count` finite numbers from `value`, or throws E1213. */
function numbersOf(value: unknown, count: number, what: string): number[] {
	if (!Array.isArray(value) || value.length !== count)
		throw new EngineError(
			'E1213',
			`The inspector got ${JSON.stringify(value)} for ${what}, which takes ${count} numbers.`,
		);
	for (const one of value)
		if (!Number.isFinite(one))
			throw new EngineError(
				'E1203',
				`The inspector got ${String(one)} in ${what}. Pass a finite number.`,
			);
	return value as number[];
}

/** The development build's inspection channel. */
export class DebugChannel {
	private readonly errors: string[] = [];

	constructor(private readonly host: DebugChannelHost) {}

	/** Records an error that the runner reported, for the `errors` call. */
	recordError(message: string): void {
		this.errors.push(message);
		if (this.errors.length > MAX_ERRORS) this.errors.shift();
	}

	/** Runs one inspection call and returns its JSON-safe value, or throws for a bad call. */
	async inspect(call: string, args: unknown): Promise<unknown> {
		switch (call) {
			case 'objects':
				return this.objects(args);
			case 'object':
				return this.detail(this.find(args));
			case 'setObject':
				return this.setObject(args);
			case 'setMaterial':
				return this.setMaterial(args);
			case 'stats':
				return await this.stats();
			case 'errors':
				return { errors: [...this.errors], count: this.errors.length };
			case 'graph':
				return { graph: this.host.render.dumpGraph() };
			case 'setQuality':
				return await this.setQuality(args);
			case 'highlight':
				return this.highlight(args);
			case 'info':
				return this.host.info();
			default:
				throw new EngineError(
					'E1213',
					`The inspector has no "${call}" call. Its calls: objects, object, setObject, setMaterial, stats, errors, graph, setQuality, highlight and info.`,
				);
		}
	}

	private async stats(): Promise<FrameStats> {
		const deadline = performance.now() + 2000;
		for (;;) {
			const stats = this.host.debug.frameStats();
			if (stats.frames > 0 || performance.now() >= deadline) return stats;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	/** Lists every live object, or the objects whose name or kind holds `filter`. */
	private objects(args: unknown): { objects: ObjectSummary[]; count: number; truncated: boolean } {
		const options = args === undefined || args === null ? {} : recordOf(args, 'a listing');
		const filter =
			typeof options.filter === 'string' && options.filter.trim() !== ''
				? options.filter.trim().toLowerCase()
				: undefined;
		const limit =
			typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0
				? Math.min(options.limit, MAX_LISTED)
				: MAX_LISTED;
		const objects: ObjectSummary[] = [];
		let count = 0;
		for (const object of this.host.scene.listObjects()) {
			const summary = this.summary(object);
			if (filter !== undefined && !`${summary.name} ${summary.kind}`.toLowerCase().includes(filter))
				continue;
			count++;
			if (objects.length < limit) objects.push(summary);
		}
		return { objects, count, truncated: count > objects.length };
	}

	/** The object that a call's `selector` names. */
	private find(args: unknown): Object3D {
		const options = recordOf(args, 'a call');
		const selector = options.selector ?? options.object;
		const object = this.resolve(selector);
		if (object !== undefined) return object;
		const shown = typeof selector === 'string' ? `"${selector}"` : String(selector);
		const near =
			typeof selector === 'string' ? this.host.scene.nearNames(selector.replace(/^#/, '')) : [];
		const hint =
			near.length > 0
				? ` Names that are close: ${near.map((name) => `"${name}"`).join(', ')}.`
				: '';
		throw new EngineError(
			'E1213',
			`The inspector found no live object for ${shown}. Name an object, give its slot as "#<slot>", or use #camera.${hint}`,
		);
	}

	/** The live object that `selector` names, or undefined. */
	private resolve(selector: unknown): Object3D | undefined {
		const { scene } = this.host;
		if (typeof selector === 'number' && Number.isInteger(selector) && selector > 0)
			return scene.objectAt(selector);
		if (typeof selector !== 'string') return undefined;
		if (selector === '#camera') return scene.shownCamera;
		if (selector.startsWith('#')) {
			const slot = Number(selector.slice(1));
			return Number.isInteger(slot) && slot > 0 ? scene.objectAt(slot) : undefined;
		}
		return scene.find(selector);
	}

	/** A listing's view of one object. */
	private summary(object: Object3D): ObjectSummary {
		const mesh = object instanceof Mesh ? object : undefined;
		const material = mesh?.material;
		return {
			slot: object.slot,
			handle: object.handle,
			name: object.name,
			kind: kindOf(object),
			dynamic: (object.flags & C.FLAG_DYNAMIC) !== 0,
			visible: (object.flags & C.FLAG_VISIBLE) !== 0,
			layers: object.layerMask,
			parent: object.liveParent?.slot ?? null,
			children: object.childObjects?.size ?? 0,
			...(material?.live ? { material: material.id } : {}),
		};
	}

	/** One object's transform, parent and material. */
	private detail(object: Object3D): ObjectDetail {
		const position: [number, number, number] = [0, 0, 0];
		const rotation: [number, number, number, number] = [0, 0, 0, 1];
		const scale: [number, number, number] = [1, 1, 1];
		const worldPosition: [number, number, number] = [0, 0, 0];
		object.getPosition(position);
		object.getRotation(rotation);
		this.host.scene.readScale(object.row, scale);
		object.getWorldPosition(worldPosition);
		const mesh = object instanceof Mesh ? object : undefined;
		const material = mesh?.material;
		return {
			...this.summary(object),
			position,
			rotation,
			scale,
			worldPosition,
			...(material?.live
				? { materialValues: { ...material.values() }, shading: material.shading }
				: {}),
		};
	}

	/** Changes an object's transform, flags or layers and returns its new state. */
	private setObject(args: unknown): ObjectDetail {
		const options = recordOf(args, 'a change');
		const object = this.find(options);
		if (options.position !== undefined) {
			const [x, y, z] = numbersOf(options.position, 3, 'position');
			object.setPosition(x as number, y as number, z as number);
		}
		if (options.rotation !== undefined) {
			const [x, y, z, w] = numbersOf(options.rotation, 4, 'rotation');
			object.setRotation(x as number, y as number, z as number, w as number);
		}
		if (options.rotationEuler !== undefined) {
			const [x, y, z] = numbersOf(options.rotationEuler, 3, 'rotationEuler');
			object.setRotationEuler(x as number, y as number, z as number);
		}
		if (options.scale !== undefined) {
			const [x, y, z] = numbersOf(options.scale, 3, 'scale');
			object.setScale(x as number, y as number, z as number);
		}
		if (options.visible !== undefined) {
			if (typeof options.visible !== 'boolean')
				throw new EngineError(
					'E1213',
					`The inspector got ${String(options.visible)} for visible, which takes true or false.`,
				);
			object.setVisible(options.visible);
		}
		if (options.dynamic !== undefined) {
			if (typeof options.dynamic !== 'boolean')
				throw new EngineError(
					'E1213',
					`The inspector got ${String(options.dynamic)} for dynamic, which takes true or false.`,
				);
			object.setDynamic(options.dynamic);
		}
		if (options.layers !== undefined) {
			if (typeof options.layers !== 'number' || !Number.isInteger(options.layers))
				throw new EngineError(
					'E1213',
					`The inspector got ${String(options.layers)} for layers, which takes a 32-bit mask.`,
				);
			object.setLayers(options.layers);
		}
		return this.detail(object);
	}

	/** Changes the material of the mesh that `selector` names and returns the object's new state. */
	private setMaterial(args: unknown): ObjectDetail {
		const options = recordOf(args, 'a material change');
		const object = this.find(options);
		if (!(object instanceof Mesh) || object.material === undefined)
			throw new EngineError(
				'E1213',
				`The inspector got ${object.describe()}, which draws no material. Give a mesh.`,
			);
		const values = recordOf(options.values, 'material values');
		object.material.set(values as MaterialOptions);
		return this.detail(object);
	}

	/** Applies a quality preset or settings and returns the engine's new quality. */
	private async setQuality(args: unknown): Promise<unknown> {
		const options = recordOf(args, 'a quality change');
		const { quality } = this.host;
		if (typeof options.preset === 'string') {
			await quality.setPreset(options.preset as QualityPreset);
		}
		if (options.settings !== undefined) {
			await quality.set(recordOf(options.settings, 'quality settings') as Partial<QualitySettings>);
		}
		return { preset: quality.preset, settings: { ...quality.settings } };
	}

	/** Outlines the object that `selector` names, or clears the outline without one. */
	private highlight(args: unknown): { selected: ObjectSummary | null } {
		const options = args === undefined || args === null ? {} : recordOf(args, 'a selection');
		const selector = options.selector ?? options.object;
		const object = selector === undefined ? undefined : this.resolve(selector);
		if (selector !== undefined && object === undefined)
			throw new EngineError(
				'E1213',
				`The inspector found no live object for ${JSON.stringify(selector)}.`,
			);
		this.host.debugDraw?.highlight(object);
		return { selected: object === undefined ? null : this.summary(object) };
	}
}
