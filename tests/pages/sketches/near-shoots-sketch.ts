// What a frame's near shoots cost on a device: a stand of six grown oaks, the core's own oak until
// the species folders land (render/near-oak.fixture.ts), seen from under the first one's crown,
// with the near pool held to `?triangles=`, the triangles that every near shoot may draw together. `?triangles=0` draws the same stand with every copy on its cards, the
// base that the shoots' cost is measured against; no value takes the preset's budget. The governor
// stays off, so the pool draws the budget it is given. The sketch posts the pool's figures as
// `near` once its task has answered.
//
// More switches take the frame apart, one change at a time: `?only=wood`, `?only=leaves` (the
// shoots, cards and merged foliage) or `?only=far` (every copy on its far card) draws one part
// alone; `?light=plain` drops the leaves' light through them and their shine, so their build takes
// no translucency; `?shadows=off` casts no sun shadow; `?coverage=off` cuts the leaves' masks
// without alpha to coverage; `?leaves=opaque` draws the leaves' whole quads with no mask, the cost
// of shading each of their pixels once; `?fade=off` turns off the dithered fade between levels;
// `?levels=coarse` switches levels at Low's distances. The sketch makes these changes in the
// context it hands the add-on, so the add-on's own code runs as it ships.
import {
	defineSketch,
	type InstanceBatch,
	type InstanceOptions,
	type Material,
	type MeshGeometry,
	type SketchContext,
} from '@null3d/engine';
import {
	bakeFarPlant,
	createNearPool,
	growPlant,
	type PlantAsset,
	type PlantCopies,
	placePlants,
	plantMaterials,
	prepareSpecies,
} from '@null3d/vegetation';
import { nearOak } from '../../../packages/vegetation/src/render/near-oak.fixture';
import woodShader from '../../../packages/vegetation/src/render/wood.wgsl';

const params = new URL(import.meta.url).searchParams;
/** The triangle budget the page asks for, or none for the preset's. */
const TRIANGLES = params.has('triangles') ? Number(params.get('triangles')) : undefined;
/** The part the page draws alone, or all of them. */
const ONLY = params.get('only') ?? 'all';
const PLAIN_LIGHT = params.get('light') === 'plain';
const COVERAGE = params.get('coverage') !== 'off';
/** `?leaves=opaque` draws the leaves' whole quads with no mask: the cost of shading each pixel once. */
const OPAQUE_LEAVES = params.get('leaves') === 'opaque';
const SHADOWS = params.get('shadows') !== 'off';
const FADE = params.get('fade') !== 'off';
const COARSE = params.get('levels') === 'coarse';
/** The level switch factor of the Low preset. */
const LOW_LOD_THRESHOLD = 2;

/** The plant shader's role uniform for wood, and the roles that draw leaves. */
const WOOD = 0;
const LEAVES = new Set([1, 2, 3]);
/** A draw range that no row of the stand reaches, which hides a batch. */
const NOWHERE = [5e8, 1e9] as const;

/** Where the oaks stand: x, z, turn in radians, scale and variant. */
const STAND: readonly (readonly [number, number, number, number, number])[] = [
	[0, 0, 0, 1, 0],
	[16, 5, 1.9, 0.95, 1],
	[-13, 14, 3.4, 1.05, 0],
	[27, -9, 0.6, 1, 1],
	[6, 25, 4.4, 0.9, 0],
	[-23, -11, 2.6, 1.1, 1],
];

/** The eye, under the first crown, and the point it looks at, across the stand. */
const EYE = [2, 1.7, 3] as const;
const TARGET = [12, 7, 10] as const;
const FOV = 60;

type ShaderOptions = Parameters<SketchContext['materials']['shader']>[0];

/**
 * The context the add-on gets: its plant materials take the page's changes to the mask and the
 * light, and each instance batch it makes is kept with its material's role.
 */
function probeContext(ctx: SketchContext, roles: Map<InstanceBatch, number>): SketchContext {
	const modes = new Map<Material, number>();
	const shader = (options: ShaderOptions) => {
		const mode = Number((options.uniforms as Record<string, number> | undefined)?.mode ?? -1);
		const changed: ShaderOptions = {
			...options,
			...(PLAIN_LIGHT && { specularIntensity: 0, diffuseTransmission: undefined }),
			...(!COVERAGE && mode !== WOOD && { alphaToCoverage: false }),
		};
		if (OPAQUE_LEAVES && LEAVES.has(mode)) {
			changed.wgsl = woodShader;
			changed.alphaMode = 'opaque';
			delete changed.alphaCutoff;
		}
		const material = ctx.materials.shader(changed);
		modes.set(material, mode);
		return material;
	};
	const materials = new Proxy(ctx.materials, {
		get: (target, key) =>
			key === 'shader' ? shader : bound(Reflect.get(target, key, target), target),
	});
	const scene = new Proxy(ctx.scene, {
		get: (target, key) =>
			key === 'createInstances'
				? (mesh: MeshGeometry, count: number, options: InstanceOptions) => {
						const batch = target.createInstances(mesh, count, options);
						roles.set(batch, modes.get(options.material) ?? -1);
						return batch;
					}
				: bound(Reflect.get(target, key, target), target),
	});
	return { ...ctx, materials, scene };
}

function bound(value: unknown, target: object): unknown {
	return typeof value === 'function' ? value.bind(target) : value;
}

export default defineSketch(async (base) => {
	const roles = new Map<InstanceBatch, number>();
	const ctx = probeContext(base, roles);
	const { scene, quality, page, geometry, materials } = base;
	void quality.set({
		governor: false,
		...(!FADE && { lodFade: false }),
		...(COARSE && { lodThreshold: LOW_LOD_THRESHOLD }),
	});
	scene.setBackground('#9fc0dd');
	scene.createAmbientLight({ intensity: 0.5 });
	scene.createHemisphereLight({ skyColor: '#dfe8f0', groundColor: '#7f8166', intensity: 1.2 });
	scene.createDirectionalLight({
		direction: [-0.45, -1, -0.35],
		intensity: 2.6,
		castShadows: SHADOWS,
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 200, height: 200 }),
		material: materials.standard({ color: '#4a5137', roughness: 1 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.05,
		far: 800,
		position: [...EYE],
		target: [...TARGET],
	});
	scene.setActiveCamera(camera);

	const kit = await prepareSpecies(ctx, nearOak());
	const grown = await Promise.all(
		[0, 1].map((variant) => growPlant(kit, { seed: 11, variant, near: true })),
	);
	// A far card that starts at once draws alone.
	const assets: PlantAsset[] =
		ONLY === 'far' ? grown.map((a) => ({ ...a, impostor: { ...a.impostor, from: 0 } })) : grown;
	const copies: PlantCopies = {
		count: STAND.length,
		position: Float32Array.from(STAND.flatMap(([x, z]) => [x, 0, z])),
		turn: Float32Array.from(STAND.map((s) => s[2])),
		scale: Float32Array.from(STAND.map((s) => s[3])),
		variant: Uint8Array.from(STAND.map((s) => s[4])),
	};
	const near =
		ONLY === 'far'
			? undefined
			: createNearPool(ctx, {
					camera,
					...(TRIANGLES !== undefined && { triangles: TRIANGLES }),
				});
	const far =
		ONLY === 'far' ? await Promise.all(grown.map((a) => bakeFarPlant(kit, a))) : undefined;
	placePlants(ctx, kit, assets, copies, {
		materials: plantMaterials(ctx, kit),
		...(near && { near }),
		...(far && { far }),
		view: { height: 1080, fov: FOV },
	});
	for (const [batch, role] of roles) {
		const hidden = (ONLY === 'wood' && role !== WOOD) || (ONLY === 'leaves' && !LEAVES.has(role));
		if (hidden) batch.setDrawRange(...NOWHERE);
	}
	let posted = false;
	const post = () =>
		page.post('near', {
			preset: quality.preset,
			only: ONLY,
			plainLight: PLAIN_LIGHT,
			coverage: COVERAGE,
			opaqueLeaves: OPAQUE_LEAVES,
			shadows: SHADOWS,
			fade: FADE,
			coarse: COARSE,
			copies: near?.copies ?? 0,
			triangles: near?.triangles ?? 0,
			budget: near?.budget ?? 0,
			detail: near?.detail,
		});
	return {
		onUpdate() {
			if (!near) {
				if (!posted) {
					posted = true;
					post();
				}
				return;
			}
			near.update();
			if (!posted && near.copies > 0) {
				posted = true;
				void near.settled().then(post);
			}
		},
	};
});
