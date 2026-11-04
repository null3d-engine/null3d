// The reader of the KHR_gaussian_splatting glTF extension. A primitive that carries the extension
// holds one point for each splat, with its center, rotation, spreads, opacity and first-band
// color. This handler turns that into the mesh and material that draw the splats: four vertices
// for each splat, with the splat's values in the mesh's attributes, and a full shader that billboards
// each quad and fades it as a Gaussian.
//
// The splats are cut into a few parts in space, so the transparent pass sorts the parts by depth and
// a model near the camera draws its nearer splats over its farther ones. The splats inside a part
// draw in the file's order; the add-on's own files draw through an instance batch, whose rows the
// engine sorts one by one.
import {
	type GltfExtensionContext,
	type GltfExtensionData,
	type GltfExtensionHandler,
	type GltfExtensionPart,
	type MeshArrays,
	registerGltfExtension,
} from '@null3d/engine';
import { colorOfSh, splatsError } from './format';
import meshShader from './splats-mesh.wgsl';

/**
 * The glTF extension that a splat file carries, which this handler reads.
 *
 * @category api/splats
 */
export const SPLAT_EXTENSION = 'KHR_gaussian_splatting';

/** The prefix of the extension's vertex attributes, such as its rotation. */
const PREFIX = `${SPLAT_EXTENSION}:`;

/** The splats that one part holds at most, which bounds a part's draw and its sort. */
const PART_SPLATS = 25_000;

/** The largest number of parts that a primitive is cut into. */
const MAX_PARTS = 64;

/** The colors of the extension, and whether a reconstructed value is an sRGB display value. */
const COLOR_SPACES: Readonly<Record<string, boolean>> = {
	srgb_rec709_display: true,
	lin_rec709_display: false,
};

/** The reader of `KHR_gaussian_splatting`, which the add-on's module registers as it loads. */
export const splatGltfHandler: GltfExtensionHandler = {
	extensions: [SPLAT_EXTENSION],
	load: (data, context) => loadPrimitive(data, context),
};

// An add-on reads its extension wherever its module loads, so a page that imports the add-on loads
// a splat model with `assets.loadGltf` and no other call. A development reload registers it again,
// which replaces the earlier handler.
registerGltfExtension(splatGltfHandler);

/** One splat of the file, as its primitive's attributes give it. */
interface Splat {
	readonly position: readonly [number, number, number];
	readonly rotation: readonly [number, number, number, number];
	readonly scale: readonly [number, number, number];
	readonly opacity: number;
	readonly color: readonly [number, number, number, number];
}

/** The parts that draw one primitive of splats. */
function loadPrimitive(
	data: GltfExtensionData,
	context: GltfExtensionContext,
): GltfExtensionPart | readonly GltfExtensionPart[] {
	const { primitive, extension } = data;
	const json = (data.json ?? {}) as { kernel?: unknown; colorSpace?: unknown };
	if (json.kernel !== undefined && json.kernel !== 'ellipse')
		throw splatsError(
			2106,
			`the glTF file gives the Gaussian kernel ${JSON.stringify(json.kernel)}, and this add-on draws the 'ellipse' kernel. Convert the file to the ellipse kernel.`,
		);
	const encoded = COLOR_SPACES[json.colorSpace as string];
	if (encoded === undefined)
		throw splatsError(
			2107,
			`the glTF file gives the color space ${JSON.stringify(json.colorSpace)}, and this add-on reads 'srgb_rec709_display' and 'lin_rec709_display'.`,
		);
	const attributes = primitive.attributes;
	const positions = attributes.POSITION;
	const rotations = attributes[`${PREFIX}ROTATION`];
	const scales = attributes[`${PREFIX}SCALE`];
	const opacities = attributes[`${PREFIX}OPACITY`];
	if (!positions || !rotations || !scales || !opacities)
		throw splatsError(
			2108,
			`the glTF splat primitive (${extension}) lacks one of POSITION, ${PREFIX}ROTATION, ${PREFIX}SCALE and ${PREFIX}OPACITY, which a splat needs.`,
		);
	const count = primitive.count;
	if (positions.length < count * 3 || rotations.length < count * 4 || scales.length < count * 3)
		throw splatsError(
			2108,
			`the glTF splat primitive holds ${count} splats, and its attributes do not hold that many.`,
		);
	const splats: Splat[] = new Array(count);
	const band = attributes[`${PREFIX}SH_DEGREE_0_COEF_0`];
	// The file's fallback color, which glTF stores linear, for a splat without the extension's band.
	const fallback = attributes.COLOR_0;
	const scratch = new Float32Array(3);
	for (let i = 0; i < count; i++) {
		const color =
			band !== undefined
				? colorOfSh(
						[band[i * 3] as number, band[i * 3 + 1] as number, band[i * 3 + 2] as number],
						encoded as boolean,
						scratch,
					)
				: fallback !== undefined
					? [
							fallback[i * 3] as number,
							fallback[i * 3 + 1] as number,
							fallback[i * 3 + 2] as number,
						]
					: [0, 0, 0];
		splats[i] = {
			position: [
				positions[i * 3] as number,
				positions[i * 3 + 1] as number,
				positions[i * 3 + 2] as number,
			],
			rotation: [
				rotations[i * 4] as number,
				rotations[i * 4 + 1] as number,
				rotations[i * 4 + 2] as number,
				rotations[i * 4 + 3] as number,
			],
			scale: [scales[i * 3] as number, scales[i * 3 + 1] as number, scales[i * 3 + 2] as number],
			opacity: opacities[i] as number,
			color: [color[0] as number, color[1] as number, color[2] as number, opacities[i] as number],
		};
	}
	const material = context.materials.shader({
		wgsl: meshShader,
		alphaMode: 'blend',
		depthWrite: false,
		// The card turns to the camera, and its own winding decides no face: draw both.
		doubleSided: true,
	});
	const order = spatialOrder(splats);
	const parts: GltfExtensionPart[] = [];
	const perPart = Math.max(PART_SPLATS, Math.ceil(count / MAX_PARTS));
	for (let first = 0; first < count; first += perPart) {
		const chosen = order.slice(first, Math.min(first + perPart, count));
		parts.push({ mesh: context.geometry.fromArrays(arraysOf(splats, chosen)), material });
	}
	return parts;
}

/** The splats' indices in a space-filling order, so each part holds nearby splats. */
function spatialOrder(splats: readonly Splat[]): Uint32Array {
	const count = splats.length;
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const { position } of splats)
		for (let k = 0; k < 3; k++) {
			min[k] = Math.min(min[k] as number, position[k] as number);
			max[k] = Math.max(max[k] as number, position[k] as number);
		}
	const span = [0, 1, 2].map((k) => {
		const size = (max[k] as number) - (min[k] as number);
		return size > 0 ? 1023 / size : 0;
	});
	const codes = new Float64Array(count);
	const order = new Uint32Array(count);
	for (let i = 0; i < count; i++) {
		const { position } = splats[i] as Splat;
		const x = Math.round(((position[0] as number) - (min[0] as number)) * (span[0] as number));
		const y = Math.round(((position[1] as number) - (min[1] as number)) * (span[1] as number));
		const z = Math.round(((position[2] as number) - (min[2] as number)) * (span[2] as number));
		codes[i] = interleave(x, y, z);
		order[i] = i;
	}
	return order.sort((a, b) => (codes[a] as number) - (codes[b] as number));
}

/** The Morton code of three 10-bit coordinates. */
function interleave(x: number, y: number, z: number): number {
	let code = 0;
	for (let bit = 0; bit < 10; bit++) {
		code += ((x >> bit) & 1) * 2 ** (3 * bit);
		code += ((y >> bit) & 1) * 2 ** (3 * bit + 1);
		code += ((z >> bit) & 1) * 2 ** (3 * bit + 2);
	}
	return code;
}

/** The vertex arrays of the chosen splats: four vertices and two triangles for each splat. */
function arraysOf(splats: readonly Splat[], chosen: Uint32Array): MeshArrays {
	const count = chosen.length;
	const positions = new Float32Array(count * 12);
	const normals = new Float32Array(count * 12);
	const uvs = new Float32Array(count * 8);
	const tangents = new Float32Array(count * 16);
	const colors = new Float32Array(count * 16);
	const indices = count * 4 > 65_535 ? new Uint32Array(count * 6) : new Uint16Array(count * 6);
	const corners = [
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1],
	];
	chosen.forEach((source, k) => {
		const splat = splats[source] as Splat;
		for (let corner = 0; corner < 4; corner++) {
			const at = k * 4 + corner;
			positions.set(splat.position, at * 3);
			normals.set(splat.scale, at * 3);
			tangents.set(splat.rotation, at * 4);
			colors.set(splat.color, at * 4);
			uvs.set(corners[corner] as number[], at * 2);
		}
		const base = k * 4;
		indices.set([base, base + 1, base + 2, base, base + 2, base + 3], k * 6);
	});
	return { positions, normals, uvs, tangents, colors, indices };
}
