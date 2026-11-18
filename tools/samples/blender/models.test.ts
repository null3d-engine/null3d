// The showcase scenes find the textures of their Blender models' materials by the order in which
// the loader makes them (`examples/lib/blender-models.ts`, `examples/lib/model-files.ts`). This test reads each pinned file's
// materials as the loader does and checks that each scene's layout names the slots that each
// material fills, so a rebuilt file that changes its materials fails here and never draws the
// wrong texture.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	CREEK_FILES as CREEK,
	ISLAND_FILES as ISLAND,
	type ModelFile,
	type Slot,
	type Slots,
} from '../../../examples/lib/model-files';
import { samplePath } from '../../lib/samples';

interface TextureInfo {
	readonly index: number;
	readonly texCoord?: number;
}
interface Gltf {
	readonly materials: readonly {
		readonly pbrMetallicRoughness?: {
			readonly baseColorTexture?: TextureInfo;
			readonly metallicRoughnessTexture?: TextureInfo;
		};
		readonly normalTexture?: TextureInfo;
		readonly occlusionTexture?: TextureInfo;
		readonly emissiveTexture?: TextureInfo;
	}[];
	readonly textures: readonly {
		readonly source?: number;
		readonly sampler?: number;
		readonly extensions?: Record<string, { readonly source: number }>;
	}[];
	readonly nodes: readonly { readonly name?: string; readonly mesh?: number }[];
	readonly meshes: readonly { readonly primitives: readonly { readonly material?: number }[] }[];
}

/** The JSON chunk of a binary glTF file. */
function readJson(file: string): Gltf {
	const bytes = readFileSync(file);
	const length = bytes.readUInt32LE(12);
	return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as Gltf;
}

/**
 * The slots that each material fills with a texture of its own, in the order the loader makes the
 * textures: a texture that an earlier slot or material already made makes none.
 */
function slotsOf(gltf: Gltf): Slots[] {
	const made = new Set<string>();
	return gltf.materials.map((material) => {
		const slots: Slot[] = [];
		const read = [
			['map', material.pbrMetallicRoughness?.baseColorTexture, 'srgb'],
			['orm', material.pbrMetallicRoughness?.metallicRoughnessTexture, 'linear'],
			['normal', material.normalTexture, 'linear'],
			['orm', material.occlusionTexture, 'linear'],
			['emissive', material.emissiveTexture, 'srgb'],
		] as const;
		for (const [slot, info, space] of read) {
			if (!info) continue;
			const texture = gltf.textures[info.index];
			const image = Object.values(texture?.extensions ?? {})[0]?.source ?? texture?.source;
			const key = `${image} ${space} ${info.texCoord ?? 0} ${texture?.sampler}`;
			if (made.has(key)) continue;
			made.add(key);
			if (slot === 'emissive') throw new Error('the scenes draw no emissive texture');
			slots.push(slot);
		}
		return slots;
	});
}

/**
 * Checks a file against its list: each material fills the slots that the list gives, and each part
 * that the list names draws with that material alone.
 */
function check(file: string, model: ModelFile): void {
	expect(file.endsWith(model.path)).toBe(true);
	const json = readJson(file);
	expect(slotsOf(json), model.path).toEqual(model.materials.map((m) => [...m.slots]));
	model.materials.forEach((material, k) => {
		for (const part of material.parts) {
			const node = json.nodes.find((n) => n.name === part);
			const primitives = json.meshes[node?.mesh ?? -1]?.primitives ?? [];
			expect(primitives.length, `${model.path} has no part named ${part}`).toBeGreaterThan(0);
			expect(
				primitives.map((p) => p.material),
				`${part} in ${model.path}`,
			).toEqual(primitives.map(() => k));
		}
	});
}

test("Creek's lists name each material's slots and parts in its files", () => {
	check(samplePath('sources/showcase/creek/trees.glb'), CREEK.trees);
	check(samplePath('sources/showcase/creek/plants.glb'), CREEK.plants);
	check(samplePath('sources/showcase/creek/cave.glb'), CREEK.cave);
});

test("the island's lists name each material's slots and parts in its files", () => {
	check(samplePath('sources/showcase/island/trees.glb'), ISLAND.trees);
	check(samplePath('sources/showcase/island/shrubs.glb'), ISLAND.shrubs);
});
