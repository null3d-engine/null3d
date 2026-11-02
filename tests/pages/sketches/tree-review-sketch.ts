// One review tree in a fixed view: the whole tree against a plain background, a close-up of its
// crown, or the crown seen from below. The species, the variant and the seed come from the query,
// so a render run draws the same frame on every device.
import { defineSketch } from '@null3d/engine';
import type { LeafCellName } from '@null3d/vegetation';
import {
	bakePlantAtlases,
	barkCellFor,
	generatePlant,
	leafCellFor,
	plantMaterial,
	type Species,
	shadowCasterLevel,
} from '@null3d/vegetation';
import { REVIEW_TREES, reviewTree } from '../lib/tree-corpus';

const params = new URL(import.meta.url).searchParams;
const CHOSEN: Species | undefined =
	reviewTree(params.get('species') ?? '') ?? REVIEW_TREES[Number(params.get('species') ?? 0)];
/** How much of the record's crown fill to draw: 0.5 for the half-filled comparison. */
const FILL = Math.max(0, Number(params.get('fill') ?? 1));
const SPECIES: Species | undefined =
	CHOSEN?.leaf && FILL !== 1
		? { ...CHOSEN, leaf: { ...CHOSEN.leaf, fill: (CHOSEN.leaf.fill ?? 0) * FILL } }
		: CHOSEN;
const VIEW = params.get('view') ?? 'whole';
const SEED = Number(params.get('seed') ?? 11);
const VARIANT = Number(params.get('variant') ?? 0);
/** How far the camera's field of view narrows the whole-tree frame. */
const WHOLE_FOV = 38;
/** How far the camera's field of view narrows a crown frame. */
const CROWN_FOV = 44;

/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

/** A direction of unit length. */
function normalize(x: number, y: number, z: number): [number, number, number] {
	const length = Math.hypot(x, y, z) || 1;
	return [x / length, y / length, z / length];
}

export default defineSketch((ctx) => {
	if (!SPECIES) throw new Error(`the review has no ${params.get('species')} tree`);
	const { scene, geometry, materials } = ctx;
	scene.setBackground('#9fc0dd');
	const LOW_SUN = params.get('sun') === 'low';
	// Every view carries the shipping shadow arrangement except the posed trunk view. A close-up
	// exists to show the bark, and a coarse crown shadow would change what the bark is judged under;
	// the trunk view therefore casts from the real level by design.
	const SHADOW_PROXY = true;
	scene.createDirectionalLight({
		direction: LOW_SUN ? [-0.85, -0.35, -0.4] : [-0.5, -1, -0.35],
		intensity: 3.1,
		castShadows: true,
		// A low sun throws a long shadow, so the map has to reach past the crown to the ground it falls on.
		shadow: { distance: LOW_SUN ? 140 : 40, contactDistance: 0.4 },
	});
	scene.createAmbientLight({ intensity: 0.5 });
	scene.createHemisphereLight({
		skyColor: '#cfe0ea',
		groundColor: '#7d7462',
		intensity: 1.3,
	});
	// A gentle light from below shows the underside of a crown in the view that looks up into it.
	scene.createDirectionalLight({ direction: [0.35, 1, 0.3], intensity: 0.8 });
	const ground = materials.standard({ color: '#8c8a80', roughness: 1, metalness: 0 });
	scene.createMesh({
		mesh: geometry.plane({ width: 400, height: 400 }),
		material: ground,
		rotation: FLAT as unknown as [number, number, number, number],
		receiveShadows: true,
	});

	const asset = generatePlant(SPECIES, { seed: SEED, variant: VARIANT });
	const atlases = bakePlantAtlases(ctx);
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(SPECIES),
		color: SPECIES.color.leaf as [number, number, number],
		transmission: SPECIES.color.transmission,
		alphaCutoff: SPECIES.leaf?.kind === 'needle' ? 0.2 : 0.24,
	});
	const bark = plantMaterial(ctx, {
		atlases,
		part: 'wood',
		color: SPECIES.color.bark as [number, number, number],
		barkCell: barkCellFor(SPECIES),
		barkTiles: 5,
	});
	const { min, max, center, radius, start } = asset.crown;
	const parts = asset.levels[0]?.parts ?? [];
	const leavesPart = parts.find((part) => part.name === 'leaves');
	const per = SPECIES.leaf?.kind === 'cluster' ? 6 : SPECIES.leaf?.cross === true ? 8 : 4;
	/** The card that the leaf view draws alone: one that faces the sky and stands at the surface. */
	let card:
		| {
				centre: [number, number, number];
				normal: [number, number, number];
				radius: number;
		  }
		| undefined;
	if (VIEW === 'leaf' && leavesPart) {
		const positions = leavesPart.arrays.positions;
		const normals = leavesPart.arrays.normals;
		let chosen = 0;
		let best = Number.NEGATIVE_INFINITY;
		for (let at = 0; at + per * 3 <= positions.length; at += per * 3) {
			let cx = 0;
			let cy = 0;
			let cz = 0;
			for (let i = 0; i < per; i++) {
				cx += positions[at + i * 3] as number;
				cy += positions[at + i * 3 + 1] as number;
				cz += positions[at + i * 3 + 2] as number;
			}
			cx /= per;
			cy /= per;
			cz /= per;
			const reach = Math.hypot(cx - center[0], cy - center[1], cz - center[2]);
			const score = (normals[at + 1] as number) + reach * 0.12;
			if (score > best) {
				best = score;
				chosen = at;
			}
		}
		let x = 0;
		let y = 0;
		let z = 0;
		let radius = 0;
		for (let i = 0; i < per; i++) {
			const vx = positions[chosen + i * 3] as number;
			const vy = positions[chosen + i * 3 + 1] as number;
			const vz = positions[chosen + i * 3 + 2] as number;
			x += vx;
			y += vy;
			z += vz;
			radius = Math.max(radius, Math.hypot(vx, vy, vz));
		}
		x /= per;
		y /= per;
		z /= per;
		let spread = 0;
		for (let i = 0; i < per; i++)
			spread = Math.max(
				spread,
				Math.hypot(
					(positions[chosen + i * 3] as number) - x,
					(positions[chosen + i * 3 + 1] as number) - y,
					(positions[chosen + i * 3 + 2] as number) - z,
				),
			);
		// A cluster card is folded, so the average of its vertex normals points between the two
		// panels; a camera along either panel's own normal would see the other edge-on.
		let nx = 0;
		let ny = 0;
		let nz = 0;
		for (let i = 0; i < per; i++) {
			nx += normals[chosen + i * 3] as number;
			ny += normals[chosen + i * 3 + 1] as number;
			nz += normals[chosen + i * 3 + 2] as number;
		}
		card = {
			centre: [x, y, z],
			normal: normalize(nx, ny, nz),
			radius: Math.max(0.05, spread),
		};
		// One card alone: the frame shows its atlas and nothing of its neighbours, so the leaf shape
		// is what the eye reads rather than the pile in front of it.
		const indices = leavesPart.arrays.indices;
		const first = chosen / 3;
		const perCard = indices.length / (positions.length / 3 / per);
		const ordinal = Math.round(chosen / (per * 3));
		const start = ordinal * perCard;
		const sliced: Uint32Array = Uint32Array.from(
			indices.subarray(start, start + perCard),
			(value) => value - first,
		);
		const arrays = {
			positions: positions.slice(chosen, chosen + per * 3),
			normals: leavesPart.arrays.normals.slice(chosen, chosen + per * 3),
			uvs: leavesPart.arrays.uvs.slice(first * 2, (first + per) * 2),
			colors: leavesPart.arrays.colors.slice(first * 4, (first + per) * 4),
			...(leavesPart.arrays.targets
				? { targets: leavesPart.arrays.targets.slice(first * 4, (first + per) * 4) }
				: {}),
			indices: sliced,
		};
		scene.createMesh({ mesh: geometry.fromArrays(arrays), material: leaves, castShadows: false });
	} else {
		// A tall dense crown hides its bole completely, so a trunk view can draw the wood alone. The
		// manifest says when a view hides the foliage.
		// A trunk view draws the wood alone: the bark is what it is for, and a crown that reaches low
		// would otherwise fill the frame with leaves.
		const hideLeaves = VIEW === 'trunk';
		// The posed trunk view keeps the real caster, so the bark is lit as bark and not as a shadow test.
		const castReal = SHADOW_PROXY && VIEW !== 'trunk';
		for (const part of parts) {
			if (hideLeaves && part.name !== 'wood') continue;
			scene.createMesh({
				mesh: geometry.fromArrays(part.arrays),
				material: part.name === 'wood' ? bark : leaves,
				castShadows: !castReal,
				receiveShadows: true,
			});
		}
		// A shadow proxy casts from the coarsest level alone, so a low sun can show what it leaves out.
		if (castReal) {
			const coarse = asset.levels[shadowCasterLevel(asset)];
			for (const part of coarse?.parts ?? []) {
				scene.createMesh({
					mesh: geometry.fromArrays(part.arrays),
					material: part.name === 'wood' ? bark : leaves,
					castShadows: true,
					receiveShadows: false,
				});
			}
		}
	}

	const crownTop = Math.max(max[1], start + 0.1);
	const span = Math.max(max[0] - min[0], max[2] - min[2], 1);
	let position: [number, number, number];
	let target: [number, number, number];
	let fov: number;
	if (VIEW === 'crown') {
		// Stand off the crown's middle and look along its side, so the close-up fills the frame with
		// the crown's structure rather than one leaf card.
		target = [center[0], start + (crownTop - start) * 0.62, center[2]];
		fov = CROWN_FOV;
		const distance = Math.max(3.5, span * 0.7 + radius * 0.55);
		const direction = normalize(0.72, 0.16, 1);
		position = [
			target[0] + direction[0] * distance,
			target[1] + direction[1] * distance,
			target[2] + direction[2] * distance,
		];
	} else if (VIEW === 'below') {
		// Stand under the crown and look up into it, as a walker sees a broadleaf canopy. The camera
		// sits outside the foliage so the branches and their gaps read.
		target = [center[0], start + (crownTop - start) * 0.55, center[2]];
		fov = CROWN_FOV;
		const reach = Math.max(4, span * 1.1);
		position = [target[0] + reach * 0.7, Math.max(1.2, start * 0.8), target[2] + reach * 0.7];
	} else if (VIEW === 'shadow') {
		// A low camera over open ground, aimed where a low sun throws the tree's shadow, so a coarse
		// caster's silhouette can be compared with the real one against the ground rather than the sky.
		const groundY = 0.15;
		const reach = Math.max(6, span * 1.6);
		// The low sun throws the shadow away from the trunk along the light's own ground direction, so
		// the camera stands beyond the shadow and looks back along it at the tree.
		target = [center[0] + reach * 0.55, groundY, center[2] + reach * 0.4];
		fov = 44;
		position = [center[0] + reach * 1.35, Math.max(1.6, span * 0.3), center[2] + reach * 1.05];
	} else if (VIEW === 'trunk') {
		// Stand close to the bole, where the bark is cleanest, so the bark's figure fills the frame.
		// The trunk's axis comes from the wood near the ground, because a crown's centre is not the
		// trunk's. A crown that reaches near the ground hides the bole from every side, and the
		// manifest says that its view draws the wood alone.
		const wood = parts.find((part) => part.name === 'wood');
		let axisX = center[0];
		let axisZ = center[2];
		let trunkRadius = 0.25;
		if (wood) {
			const positions = wood.arrays.positions;
			let sx = 0;
			let sz = 0;
			let n = 0;
			for (let at = 0; at + 2 < positions.length; at += 9) {
				const y = positions[at + 1] as number;
				if (y > 0.35) continue;
				sx += positions[at] as number;
				sz += positions[at + 2] as number;
				n += 1;
			}
			if (n > 0) {
				axisX = sx / n;
				axisZ = sz / n;
			}
			const distances: number[] = [];
			for (let at = 0; at + 2 < positions.length; at += 9) {
				const d = Math.hypot(
					(positions[at] as number) - axisX,
					(positions[at + 2] as number) - axisZ,
				);
				if (d > 0.02) distances.push(d);
			}
			distances.sort((a, b) => a - b);
			trunkRadius = Math.max(0.08, (distances[Math.floor(distances.length * 0.04)] ?? 0.25) * 1.1);
		}
		// A crown whose foliage begins near the ground leaves no clear bole from any side.
		const dense = start < 2.2;
		const height = dense ? max[1] * 0.45 : Math.max(1, Math.min(start * 0.6, 2.6));
		target = [axisX, height, axisZ];
		fov = 34;
		const reach = dense ? trunkRadius * 6 : Math.min(2.6, Math.max(0.6, trunkRadius * 3.2));
		const direction = normalize(0.55, 0.05, 1);
		position = [
			target[0] + direction[0] * reach,
			target[1] + direction[1] * reach,
			target[2] + direction[2] * reach,
		];
	} else if (VIEW === 'leaf' && card) {
		// Stand on the card's own normal and frame the card alone.
		target = card.centre;
		fov = 34;
		const distance = card.radius * 3.2;
		// A card that faces straight up would put the camera's up axis along the view, which leaves
		// the view without a basis; a small sideways lean keeps it well defined.
		const facing = normalize(card.normal[0] + 0.18, card.normal[1] + 0.02, card.normal[2] + 0.18);
		position = [
			target[0] + facing[0] * distance,
			target[1] + facing[1] * distance,
			target[2] + facing[2] * distance,
		];
	} else {
		target = [center[0], min[1] + (max[1] - min[1]) * 0.48, center[2]];
		fov = WHOLE_FOV;
		const vertical = (fov * Math.PI) / 180;
		const distance =
			(Math.max(max[0] - min[0], (max[1] - min[1]) * 1.05) / 2 / Math.tan(vertical / 2)) * 1.18;
		const direction = normalize(0.62, 0.2, 1);
		position = [
			target[0] + direction[0] * distance,
			target[1] + direction[1] * distance,
			target[2] + direction[2] * distance,
		];
	}
	const camera = scene.createPerspectiveCamera({
		fov,
		near: 0.05,
		far: 800,
		position,
		target,
	});
	scene.setActiveCamera(camera);
	return {};
});
