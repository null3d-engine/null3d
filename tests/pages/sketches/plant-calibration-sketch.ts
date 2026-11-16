// One leaf of the pedunculate oak, drawn by the plant shader's merged-foliage role from the oak's
// shipped leaf textures, beside two plain reference squares that the engine's standard material
// draws in the record's colours. `tests/image/plant-calibration.spec.ts` reads the pictures back in
// linear light and holds the leaf to the squares.
//
// The calibration record keeps the textures' own means as its reflectances, so a front-lit leaf
// must show its texture's colours, and a transmittance of its own. ?light= picks the light:
// `front` (a sun 45 degrees off the leaf's normal on the camera's side), `back` (the same sun from
// behind the leaf) or `sky` (an even ambient light alone). ?face= turns the leaf's `upper` or
// `lower` face to the camera. The left half holds the leaf; the right half holds the reference of
// the face's reflectance above and of the transmittance below, both lit by the same light as the
// leaf. No tone curve runs, so a pixel is the linear light in sRGB. The reflectance's square carries
// the leaf's gloss; the transmittance's carries none, as light through a leaf has no highlight; a
// black square with the leaf's gloss, to their right, holds the highlight alone.
import { defineSketch, type SketchContext } from '@null3d/engine';
import { type Species, type SpeciesKit, speciesBox, standInRecord } from '@null3d/vegetation';
import { files } from '@null3d/vegetation-textures/pedunculate-oak';
import type { MeshArrays } from '../../../packages/vegetation/src/asset';
import { placeholderQuantise } from '../../../packages/vegetation/src/core/placeholder';
import { TEXTURE_UV_STEPS } from '../../../packages/vegetation/src/lod/quantise';
import {
	plantBounds,
	plantGeometry,
	plantMaterials,
} from '../../../packages/vegetation/src/render/material';
import { speciesHeader } from '../../../packages/vegetation/src/render/records';
import { kitTextures, loadTextureSet } from '../../../packages/vegetation/src/render/textures';
import {
	CALIBRATION_ROUGHNESS,
	CALIBRATION_TRANSMITTANCE,
	calibrationSky,
	calibrationSun,
	LEAF_PLACE,
	REFERENCE_PLACES,
	REFERENCE_SIDE,
	VIEW,
} from '../lib/plant-calibration';

const params = new URL(import.meta.url).searchParams;
const LIGHT = params.get('light') ?? 'front';
const FACE = params.get('face') ?? 'upper';

/** The calibration record: a stand-in broadleaf whose leaf optics are the oak's measured means. */
function calibrationRecord(): Species {
	const base = standInRecord('plant-calibration', { height: 2 });
	const leaf = files.manifest.leaf;
	if (!leaf) throw new Error('the oak ships no leaf textures');
	if (base.foliage.kind !== 'blade') throw new Error('the stand-in record has no blade leaf');
	return {
		...base,
		foliage: {
			...base.foliage,
			leaf: {
				...base.foliage.leaf,
				optics: {
					reflectance: leaf.mean.upper,
					reflectanceBack: leaf.mean.lower,
					transmittance: CALIBRATION_TRANSMITTANCE,
					roughness: CALIBRATION_ROUGHNESS,
				},
			},
		},
	};
}

/** A kit of the record and the oak's textures, with no shoots, cards or wind. */
async function calibrationKit(ctx: SketchContext, record: Species): Promise<SpeciesKit> {
	const box = speciesBox(record);
	const data = {
		record,
		manifest: files.manifest,
		key: 'plant-calibration',
		detail: 'high' as const,
		box,
		prototypes: [],
		leaves: [],
		cards: { size: 0, color: new Uint8Array(0), surface: new Uint8Array(0) },
		header: speciesHeader(record, files.manifest, box),
	};
	const loaded = await loadTextureSet(ctx, files, 'full');
	return { ...data, textures: kitTextures(ctx, data, 'full', loaded) };
}

/** One leaf: a square of the leaf texture, a metre a side, facing +Z, its stalk at the bottom. */
function leafSquare(): MeshArrays {
	return {
		positions: new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]),
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
		uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
		uvs1: new Float32Array(8),
		// No wind record moves it, and its crown leaves it in the open: full sky visibility.
		colors: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
		indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
	};
}

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, post, quality } = ctx;
	quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false, bounceRays: 0 });
	post.set({ toneMapping: 'none', exposure: 1, ao: false });
	scene.setBackground('#000000');
	scene.setActiveCamera(
		scene.createOrthographicCamera({
			height: VIEW.height,
			near: 1,
			far: 20,
			position: [0, VIEW.centre, 10],
			target: [0, VIEW.centre, 0],
		}),
	);
	const record = calibrationRecord();
	if (record.foliage.kind !== 'blade') return;
	const optics = record.foliage.leaf.optics;
	const reflectance = FACE === 'lower' ? optics.reflectanceBack : optics.reflectance;
	// The leaf faces +Z; turning it about +Y shows its lower face. The sun comes 45 degrees off the
	// leaf's normal, from the camera's side or from behind, in the plane across the view. Its
	// strength puts the face's brightest channel near half of white, where 8-bit pixels hold about
	// 0.5 per cent steps of linear light.
	const sun = calibrationSun(reflectance);
	const along = Math.SQRT1_2;
	if (LIGHT === 'front')
		scene.createDirectionalLight({
			direction: [along, 0, -along],
			color: '#ffffff',
			intensity: sun,
		});
	if (LIGHT === 'back')
		scene.createDirectionalLight({
			direction: [along, 0, along],
			color: '#ffffff',
			intensity: sun,
		});
	if (LIGHT === 'sky')
		scene.createAmbientLight({ color: '#ffffff', intensity: calibrationSky(reflectance) });
	const kit = await calibrationKit(ctx, record);
	const plant = plantMaterials(ctx, kit);
	const mesh = plantGeometry(ctx, placeholderQuantise(leafSquare(), kit.box, TEXTURE_UV_STEPS));
	const part = scene.createMesh({
		mesh,
		material: plant.foliage,
		position: [LEAF_PLACE[0], LEAF_PLACE[1], 0],
		rotation: FACE === 'lower' ? [0, 1, 0, 0] : [0, 0, 0, 1],
		castShadows: false,
		receiveShadows: false,
	});
	// The part's mesh holds 16-bit steps, so its own sphere misses the box that the shader draws.
	const { center, radius } = plantBounds(kit.box);
	part.setBounds(center, radius);
	const square = geometry.plane({ width: REFERENCE_SIDE, height: REFERENCE_SIDE });
	const roughness = optics.roughness[FACE === 'lower' ? 1 : 0];
	// The face's reflectance, with the leaf's own gloss, and the transmittance, which carries none.
	scene.createMesh({
		mesh: square,
		material: materials.standard({
			color: [...reflectance],
			roughness,
			metalness: 0,
			specularIntensity: 0.035 / 0.04,
		}),
		position: [...REFERENCE_PLACES.reflectance, 0],
		castShadows: false,
		receiveShadows: false,
	});
	scene.createMesh({
		mesh: square,
		material: materials.standard({
			color: [...CALIBRATION_TRANSMITTANCE],
			roughness: 1,
			metalness: 0,
			specularIntensity: 0,
		}),
		position: [...REFERENCE_PLACES.transmittance, 0],
		castShadows: false,
		receiveShadows: false,
	});
	scene.createMesh({
		mesh: square,
		material: materials.standard({
			color: [0, 0, 0],
			roughness,
			metalness: 0,
			specularIntensity: 0.035 / 0.04,
		}),
		position: [...REFERENCE_PLACES.gloss, 0],
		castShadows: false,
		receiveShadows: false,
	});
});
