// glTF extension handlers: the parser keeps a primitive that an add-on's handler reads, the
// loader hands it to the handler, and the parts that the handler returns draw in the model.

import { beforeEach, expect, test } from 'bun:test';
import { GltfBuilder } from '../../../../tests/pages/lib/gltf-files';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { Assets, type GltfExtensionData, type GltfExtensionHandler } from './assets';
import { type GltfContext, makePrefab } from './gltf';
import { GltfExtensions, registerGltfExtension } from './gltf-extensions';
import { parseGltf, readContainer } from './gltf-parse';
import type { Material, MeshGeometry } from './resources';
import type { Textures } from './textures';

beforeEach(() => setErrorFixes(ERROR_FIXES));

const EXTENSION = 'KHR_gaussian_splatting';
const URL_OF = 'https://example.com/models/splats.glb';

/**
 * A file whose one node draws a point cloud through the splat extension: three splats, with a
 * position, a rotation, a scale and an opacity each.
 */
function splatFile(): Uint8Array {
	const b = new GltfBuilder().uses(EXTENSION, true);
	const positions = b.positions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
	const rotations = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), 4);
	const scales = b.accessor(new Float32Array([1, 1, 1, 2, 2, 2, 0.5, 0.5, 0.5]), 3);
	const opacities = b.accessor(new Float32Array([1, 0.5, 0.25]), 1);
	const mesh = b.mesh(
		[
			{
				attributes: {
					POSITION: positions,
					[`${EXTENSION}:ROTATION`]: rotations,
					[`${EXTENSION}:SCALE`]: scales,
					[`${EXTENSION}:OPACITY`]: opacities,
				},
				mode: 0,
				extensions: { [EXTENSION]: { kernel: 'ellipse', colorSpace: 'srgb_rec709_display' } },
			},
		],
		'Splats',
	);
	b.node({ name: 'Cloud', mesh, translation: [1, 2, 3] });
	return b.glb();
}

test('a required extension that an add-on reads names the package to import without its handler', () => {
	const file = splatFile();
	expect(() => readContainer(file, URL_OF)).toThrow(
		`it requires ${EXTENSION}, which the engine does not read. Import @null3d/splats, which reads it`,
	);
	// A registered handler makes the same file load.
	expect(() => readContainer(file, URL_OF, [EXTENSION])).not.toThrow();
});

test('a claimed primitive gives every attribute as floats, whatever its name', () => {
	const container = readContainer(splatFile(), URL_OF, [EXTENSION]);
	const data = parseGltf(container, new Map(), URL_OF, {}, [EXTENSION]);
	const [mesh] = data.meshes;
	// The primitive draws only through the handler, so it is none of the engine's primitives.
	expect(mesh?.primitives).toEqual([]);
	const [primitive] = mesh?.extensionPrimitives ?? [];
	expect(primitive?.extensions).toEqual([
		{
			name: EXTENSION,
			json: { kernel: 'ellipse', colorSpace: 'srgb_rec709_display' },
		},
	]);
	expect(primitive?.attributes.POSITION).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
	expect(primitive?.attributes[`${EXTENSION}:OPACITY`]).toEqual(new Float32Array([1, 0.5, 0.25]));
	expect(primitive?.count).toBe(3);
	expect(primitive?.mode).toBe(0);
	expect(primitive?.material).toBe(-1);
	// No handler read the points, so the file's notes say nothing about them.
	expect(data.notes).toEqual([]);
});

test('a file that only uses the extension leaves its points out when no handler reads it', () => {
	const b = new GltfBuilder().uses(EXTENSION);
	const positions = b.positions(new Float32Array([0, 0, 0]));
	const mesh = b.mesh([{ attributes: { POSITION: positions }, mode: 0 }]);
	b.node({ name: 'Cloud', mesh });
	const data = parseGltf(readContainer(b.glb(), URL_OF), new Map(), URL_OF);
	expect(data.meshes[0]?.primitives).toEqual([]);
	expect(data.meshes[0]?.extensionPrimitives).toBeUndefined();
	expect(data.notes[0]).toContain('draws points or lines');
});

/** A loader context with the engine's makers faked, which records what a handler makes and frees. */
function fakeContext(handlers: readonly GltfExtensionHandler[]): {
	context: GltfContext;
	made: { meshes: MeshGeometry[]; materials: Material[] };
	destroyed: Material[];
} {
	const made = { meshes: [] as MeshGeometry[], materials: [] as Material[] };
	const destroyed: Material[] = [];
	const error = (code: string, message: string) => new EngineError(code as 'E1416', `${message}.`);
	const newMaterial = () => {
		const material = {
			live: true,
			destroy: () => {
				destroyed.push(material);
			},
		} as Material;
		return material;
	};
	const context = {
		core: {},
		textures: {},
		geometry: {
			fromArrays: () => {
				const mesh = { id: made.meshes.length + 1, radius: 1, live: true } as MeshGeometry;
				made.meshes.push(mesh);
				return mesh;
			},
			destroyMeshes: () => {},
		},
		materials: {
			standard: () => {
				const material = newMaterial();
				made.materials.push(material);
				return material;
			},
			unlit: () => {
				const material = newMaterial();
				made.materials.push(material);
				return material;
			},
			shaders: { need: () => {}, needListed: () => {} },
		},
		scene: { checks: { error } },
		download: async () => new Blob(),
		decode: async () => ({}) as ImageBitmap,
		reloadsFrom: () => {},
		error,
		extensionHandlers: handlers,
	};
	return { context: context as unknown as GltfContext, made, destroyed };
}

test('a registered handler gets the extension and its parts draw in copies of the model', async () => {
	const calls: GltfExtensionData[] = [];
	let part: { mesh: MeshGeometry; material: Material } | undefined;
	const handler: GltfExtensionHandler = {
		extensions: [EXTENSION],
		load(data, makers) {
			calls.push(data);
			part = {
				mesh: makers.geometry.fromArrays({
					positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
				}),
				material: makers.materials.standard({ color: [1, 0, 0] }),
			};
			return part;
		},
	};
	const { context, destroyed } = fakeContext([handler]);
	const file = splatFile();
	const data = parseGltf(readContainer(file, URL_OF, [EXTENSION]), new Map(), URL_OF, {}, [
		EXTENSION,
	]);
	const prefab = await makePrefab(context, data, [], new URL(URL_OF), 'assets.loadGltf');
	expect(calls).toHaveLength(1);
	const [call] = calls;
	expect(call?.extension).toBe(EXTENSION);
	expect(call?.json).toEqual({ kernel: 'ellipse', colorSpace: 'srgb_rec709_display' });
	expect(call?.node).toEqual({
		name: 'Cloud',
		position: [1, 2, 3],
		rotation: [0, 0, 0, 1],
		scale: [1, 1, 1],
	});
	expect(Object.keys(call?.primitive.attributes ?? {}).sort()).toEqual(
		['POSITION', `${EXTENSION}:OPACITY`, `${EXTENSION}:ROTATION`, `${EXTENSION}:SCALE`].sort(),
	);
	expect(call?.primitive.count).toBe(3);
	expect(call?.primitive.mode).toBe(0);
	expect(call?.primitive.material).toBeUndefined();
	// The node draws the handler's part, and every copy of the model shares it.
	const node = prefab.find('Cloud');
	expect(node?.mesh).toBe(part?.mesh as MeshGeometry);
	expect(node?.material).toBe(part?.material as Material);
	expect(prefab.parts.map((p) => p.mesh)).toEqual([part?.mesh as MeshGeometry]);
	// Its bounds hold the node's place, and destroying the model frees the handler's material.
	expect(prefab.bounds.center).toEqual([1, 2, 3]);
	prefab.destroy();
	expect(destroyed).toContain(part?.material as Material);
});

test('the assets registry keeps one handler for each extension, and its removal frees the name', () => {
	const assets = new Assets({} as Textures, URL_OF);
	const handler: GltfExtensionHandler = { extensions: [EXTENSION], load: () => {} };
	const remove = assets.registerGltfExtension(handler);
	expect(() => assets.registerGltfExtension({ extensions: [EXTENSION], load: () => {} })).toThrow(
		'E1213',
	);
	remove();
	expect(() =>
		assets.registerGltfExtension({ extensions: [EXTENSION], load: () => {} }),
	).not.toThrow();
});

test('a handler without extension names or without load() is refused', () => {
	const assets = new Assets({} as Textures, URL_OF);
	expect(() => assets.registerGltfExtension({ extensions: [], load: () => {} })).toThrow('E1213');
	expect(() =>
		assets.registerGltfExtension({ extensions: [EXTENSION] } as unknown as GltfExtensionHandler),
	).toThrow('E1213');
});

test('an add-on handler serves every sketch, and a sketch’s own takes its place', () => {
	const name = 'EXT_addon_marker';
	const addon: GltfExtensionHandler = { extensions: [name], load: () => {} };
	const remove = registerGltfExtension(addon);
	try {
		// Every sketch's registry reads the add-on's handler, with no call on its assets.
		expect(new GltfExtensions().all()).toContain(addon);
		// A handler that the sketch registers for the extension reads the files in its place.
		const own: GltfExtensionHandler = { extensions: [name], load: () => {} };
		const extensions = new GltfExtensions();
		const removeOwn = extensions.register(own);
		const all = extensions.all();
		expect(all).toContain(own);
		expect(all).not.toContain(addon);
		removeOwn();
		expect(extensions.all()).toContain(addon);
	} finally {
		remove();
	}
	expect(new GltfExtensions().all()).not.toContain(addon);
});

test('an add-on handler without extension names or without load() is refused', () => {
	expect(() => registerGltfExtension({ extensions: [], load: () => {} })).toThrow('E1213');
	expect(() =>
		registerGltfExtension({ extensions: [EXTENSION] } as unknown as GltfExtensionHandler),
	).toThrow('E1213');
});
