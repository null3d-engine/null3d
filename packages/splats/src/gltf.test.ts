// The KHR_gaussian_splatting reader: the attributes that a splat needs, the quad that each splat
// becomes, and the color that its first spherical-harmonic band gives. The test registers the
// handler with stand-ins for the assets, geometry and materials, so it reads no GPU and ships
// nothing.
import { describe, expect, it } from 'bun:test';
import type {
	GltfExtensionContext,
	GltfExtensionData,
	GltfExtensionPart,
	MeshArrays,
} from '@null3d/engine';
import { SPLAT_EXTENSION, splatGltfHandler } from './gltf';

/** The attributes of three splats, in the extension's names. */
function attributes(shDegree0 = true): Record<string, Float32Array> {
	const found: Record<string, Float32Array> = {
		POSITION: new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6]),
		[`${SPLAT_EXTENSION}:ROTATION`]: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
		[`${SPLAT_EXTENSION}:SCALE`]: new Float32Array([0.1, 0.2, 0.3, 0.1, 0.1, 0.1, 1, 1, 1]),
		[`${SPLAT_EXTENSION}:OPACITY`]: new Float32Array([0.5, 1, 0.25]),
	};
	if (shDegree0) found[`${SPLAT_EXTENSION}:SH_DEGREE_0_COEF_0`] = new Float32Array(9);
	return found;
}

/** The primitive's data, as the loader hands it to a handler. */
function primitive(found = attributes(), colorSpace = 'srgb_rec709_display'): GltfExtensionData {
	return {
		extension: SPLAT_EXTENSION,
		json: { kernel: 'ellipse', colorSpace },
		node: { name: 'splats', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
		primitive: {
			attributes: found,
			count: 3,
			indices: undefined,
			mode: 0,
			material: undefined,
		},
	};
}

/** A context that keeps each mesh's arrays and returns a stand-in material. */
function context(): { context: GltfExtensionContext; arrays: MeshArrays[] } {
	const arrays: MeshArrays[] = [];
	return {
		arrays,
		context: {
			geometry: {
				fromArrays: (made: MeshArrays) => {
					arrays.push(made);
					return {} as never;
				},
			} as unknown as GltfExtensionContext['geometry'],
			materials: { shader: () => ({}) as never } as unknown as GltfExtensionContext['materials'],
		},
	};
}

/** The handler that the package registers as its module loads. */
function handler() {
	return splatGltfHandler;
}

/** The parts that the handler makes, and the arrays of each mesh it made. */
async function load(
	data: GltfExtensionData,
	made = context(),
): Promise<{ parts: readonly GltfExtensionPart[]; arrays: MeshArrays[] }> {
	const returned = await handler().load(data, made.context);
	const parts = (
		Array.isArray(returned) ? returned : returned ? [returned] : []
	) as readonly GltfExtensionPart[];
	return { parts, arrays: made.arrays };
}

describe('the KHR_gaussian_splatting handler', () => {
	it('makes four vertices and two triangles for each splat', async () => {
		const { parts, arrays } = await load(primitive());
		expect(parts.length).toBe(1);
		expect(arrays.length).toBe(1);
		const mesh = arrays[0] as unknown as { positions: Float32Array; indices: Uint16Array };
		expect(mesh.positions.length).toBe(3 * 4 * 3);
		expect(mesh.indices.length).toBe(3 * 6);
	});

	it('writes each splat into its quad: the center, the spreads, the rotation and the color', async () => {
		const { arrays } = await load(primitive());
		const mesh = arrays[0] as unknown as {
			positions: Float32Array;
			normals: Float32Array;
			tangents: Float32Array;
			colors: Float32Array;
			uvs: Float32Array;
			indices: Uint16Array;
		};
		expect(mesh.positions.length).toBe(3 * 4 * 3);
		expect(mesh.indices.length).toBe(3 * 6);
		// The first quad's four corners share the splat's center and its spreads.
		expect([...mesh.positions.subarray(0, 3)]).toEqual([0, 0, 0]);
		expect(mesh.normals[0] as number).toBeCloseTo(0.1, 5);
		expect(mesh.normals[1] as number).toBeCloseTo(0.2, 5);
		expect(mesh.normals[2] as number).toBeCloseTo(0.3, 5);
		expect([...mesh.tangents.subarray(0, 4)]).toEqual([0, 0, 0, 1]);
		// The first band's zero is the middle of the range, an sRGB half that decodes to a gray.
		expect(mesh.colors[0] as number).toBeCloseTo(0.214, 3);
		expect(mesh.colors[3] as number).toBe(0.5);
		// The corners run from the low left one, as the quad's texture coordinates.
		expect([...mesh.uvs.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
	});

	it('reads a linear color space without decoding it', async () => {
		const { arrays } = await load(primitive(attributes(), 'lin_rec709_display'));
		// The first band's zero is the middle of the range, which is 0.5 in a linear space.
		expect((arrays[0] as unknown as { colors: Float32Array }).colors[0] as number).toBeCloseTo(
			0.5,
			5,
		);
	});

	it('uses the file’s own color where it gives no first band', async () => {
		const found = attributes(false);
		found.COLOR_0 = new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
		const { arrays } = await load(primitive(found));
		// glTF stores a color linear, and the fallback keeps it as it is.
		expect((arrays[0] as unknown as { colors: Float32Array }).colors[0] as number).toBeCloseTo(
			1,
			5,
		);
	});

	it('refuses a primitive that lacks a splat attribute', async () => {
		const found = attributes();
		delete found[`${SPLAT_EXTENSION}:OPACITY`];
		await expect(load(primitive(found))).rejects.toThrow('OPACITY');
	});

	it('refuses a color space that it does not read', async () => {
		await expect(load(primitive(attributes(), 'display-p3'))).rejects.toThrow('color space');
	});

	it('refuses a kernel that it does not draw', async () => {
		const data = {
			...primitive(),
			json: { kernel: 'rectangle', colorSpace: 'srgb_rec709_display' },
		};
		await expect(load(data)).rejects.toThrow('kernel');
	});
});
