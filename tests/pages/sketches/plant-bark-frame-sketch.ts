// One limb of bark, drawn by the plant shader's wood role: a tube whose bark normal map holds
// ridges that run along the limb. `tests/image/plant-bark-frame.spec.ts` draws it standing and
// lying, with the sun turned with it, and holds the two pictures equal once the lying one is turned
// back: bark lit by a frame from its own texture coordinates lights along its ridges however the
// limb points, where a frame from the world's up lights a lying limb across them.
//
// ?pose=standing or ?pose=lying turns the limb; ?relief=ridges or ?relief=flat picks the normal map,
// so the test also knows that the ridges show.
import { defineSketch, type SketchContext, type Texture } from '@null3d/engine';
import { type SpeciesKit, speciesBox, standInRecord } from '@null3d/vegetation';
import type { MeshArrays } from '../../../packages/vegetation/src/asset';
import { placeholderQuantise } from '../../../packages/vegetation/src/core/placeholder';
import { noTextureFiles } from '../../../packages/vegetation/src/core/textures';
import { WOOD_UV_STEPS } from '../../../packages/vegetation/src/lod/quantise';
import {
	plantBounds,
	plantGeometry,
	plantMaterials,
} from '../../../packages/vegetation/src/render/material';
import { speciesHeader } from '../../../packages/vegetation/src/render/records';
import { kitTextures } from '../../../packages/vegetation/src/render/textures';
import { BARK_FRAME } from '../lib/plant-bark-frame';

const params = new URL(import.meta.url).searchParams;
const LYING = params.get('pose') === 'lying';
const FLAT = params.get('relief') === 'flat';

/** Texels a side of the made bark textures. */
const TEXELS = 64;

/** A bark normal map of ridges along v, or a flat one: the normal leans along u and back. */
function barkNormal(ctx: SketchContext): Texture {
	const data = new Uint8Array(TEXELS * TEXELS * 4);
	for (let y = 0; y < TEXELS; y++)
		for (let x = 0; x < TEXELS; x++) {
			const lean = FLAT ? 0 : 0.6 * Math.sin((2 * Math.PI * BARK_FRAME.ridges * x) / TEXELS);
			const z = Math.sqrt(1 - lean * lean);
			const at = (y * TEXELS + x) * 4;
			data.set(
				[Math.round((lean * 0.5 + 0.5) * 255), 128, Math.round((z * 0.5 + 0.5) * 255), 255],
				at,
			);
		}
	return ctx.textures.fromData({
		width: TEXELS,
		height: TEXELS,
		depth: 1,
		data,
		colorSpace: 'linear',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/** A layer of one grey, the bark's colour. */
function grey(ctx: SketchContext, array: boolean): Texture {
	return ctx.textures.fromData({
		width: 1,
		height: 1,
		...(array && { depth: 1 }),
		data: new Uint8Array([150, 150, 150, 255]),
		colorSpace: 'srgb',
		wrap: 'repeat',
	});
}

/** The limb: a tube up +Y from the origin, its bark coordinates in metres round and along. */
function limb(): MeshArrays {
	const { radius, length } = BARK_FRAME;
	const around = 48;
	const along = 12;
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let j = 0; j <= along; j++)
		for (let i = 0; i <= around; i++) {
			const angle = (2 * Math.PI * i) / around;
			const x = Math.cos(angle);
			const z = -Math.sin(angle);
			positions.push(radius * x, (length * j) / along, radius * z);
			normals.push(x, 0, z);
			uvs.push((angle * radius) % 64, (length * j) / along);
		}
	for (let j = 0; j < along; j++)
		for (let i = 0; i < around; i++) {
			const a = j * (around + 1) + i;
			const b = a + around + 1;
			indices.push(a, a + 1, b + 1, a, b + 1, b);
		}
	const count = positions.length / 3;
	const uvs1 = new Float32Array(count * 2);
	const colors = new Uint8Array(count * 4);
	for (let v = 0; v < count; v++) {
		uvs1[v * 2] = radius / 4;
		colors[v * 4 + 3] = 255;
	}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		uvs: new Float32Array(uvs),
		uvs1,
		colors,
		indices: new Uint16Array(indices),
	};
}

/** A kit of a stand-in record with the made bark textures. */
function barkKit(ctx: SketchContext): SpeciesKit {
	const record = standInRecord('plant-bark-frame', { height: 2 });
	const files = noTextureFiles(record.id);
	const box = speciesBox(record);
	const data = {
		record,
		manifest: files.manifest,
		key: 'plant-bark-frame',
		detail: 'high' as const,
		box,
		prototypes: [],
		leaves: [],
		cards: { size: 0, color: new Uint8Array(0), surface: new Uint8Array(0) },
		header: speciesHeader(record, files.manifest, box),
	};
	const loaded = {
		leafColor: grey(ctx, true),
		leafNormal: grey(ctx, true),
		barkColor: grey(ctx, true),
		barkNormal: barkNormal(ctx),
		youngColor: grey(ctx, false),
		youngNormal: grey(ctx, false),
	};
	return { ...data, textures: kitTextures(ctx, data, 'full', loaded) };
}

/** A vector turned a quarter turn about +Z, as the lying limb is. */
const lie = ([x, y, z]: readonly number[]): [number, number, number] => [
	-(y as number),
	x as number,
	z as number,
];

export default defineSketch((ctx) => {
	const { scene, post, quality } = ctx;
	quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false, bounceRays: 0 });
	post.set({ toneMapping: 'none', exposure: 1, ao: false });
	scene.setBackground('#000000');
	scene.setActiveCamera(
		scene.createOrthographicCamera({
			height: BARK_FRAME.view,
			near: 1,
			far: 20,
			position: [0, 0, 10],
			target: [0, 0, 0],
		}),
	);
	// A sun from the camera's side that rakes across the standing limb's ridges, turned with it.
	const sun: [number, number, number] = [0.75, -0.3, -0.6];
	scene.createDirectionalLight({
		direction: LYING ? lie(sun) : sun,
		color: '#ffffff',
		intensity: 3,
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.3 });
	const kit = barkKit(ctx);
	const wood = plantMaterials(ctx, kit).wood;
	const mesh = plantGeometry(ctx, placeholderQuantise(limb(), kit.box, WOOD_UV_STEPS));
	const half = BARK_FRAME.length / 2;
	const quarter = Math.SQRT1_2;
	const part = scene.createMesh({
		mesh,
		material: wood,
		position: LYING ? [half, 0, 0] : [0, -half, 0],
		rotation: LYING ? [0, 0, quarter, quarter] : [0, 0, 0, 1],
		castShadows: false,
		receiveShadows: false,
	});
	// The part's mesh holds 16-bit steps, so its own sphere misses the box that the shader draws.
	const { center, radius } = plantBounds(kit.box);
	part.setBounds(center, radius);
});
