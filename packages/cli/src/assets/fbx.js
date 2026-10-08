// FBX and OBJ files for assets convert. ufbx reads them, built to WebAssembly with the tool's own
// code in packages/cli/native/fbx.c, which hands over the scene as glTF needs it: welded triangle
// lists by material, skins, morph targets and baked clips, in glTF's space. This module builds
// the glTF document from that, and turns the materials into glTF's metal-rough materials.
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength, KHRTextureTransform } from '@gltf-transform/extensions';
import { encodePng } from '../png.js';
import { accessor, createPrimitive, gltfImage } from './convert-document.js';
import { readHeights, readPixels } from './image-files.js';
import { isGray, normalsFromHeights, packChannels } from './maps.js';

/** @import { Material, Mesh, Node, Skin, Texture, TextureInfo } from '@gltf-transform/core' */
/** @import { ChannelSource } from './maps.js' */

/** The reader's WebAssembly module, which tools/build-ufbx.ts builds. */
export const UFBX_WASM = fileURLToPath(new URL('../../vendor/ufbx/ufbx.wasm', import.meta.url));

/** The rate, in keys a second, at which clips whose curves need keys between their own bake. */
export const BAKE_RATE = 30;

/** ufbx's shader types of FBX's own Phong material and of OBJ's MTL materials. */
const FBX_PHONG = 2;
const WAVEFRONT_MTL = 12;

/** A sampler's wrap mode that ufbx calls clamp. */
const UFBX_CLAMP = 1;

/** @type {Promise<any> | undefined} */
let reader;

/** The reader's exports, loaded on the first call. */
function loadReader() {
	reader ??= (async () => {
		const { instance } = await WebAssembly.instantiate(readFileSync(UFBX_WASM), {
			env: { emscripten_notify_memory_growth: () => {} },
		});
		/** @type {any} */
		const exports = instance.exports;
		exports._initialize();
		return exports;
	})();
	return reader;
}

/**
 * A map of a material as the reader gives it: a value of up to four numbers, whether the file
 * set it, and the texture that replaces it.
 *
 * @typedef {{ value: number[], has: boolean, texture?: number }} MaterialMap
 */

/**
 * The scene that the reader gives. Arrays are `[byte offset, count]` in its binary block.
 *
 * @typedef {object} UfbxScene
 * @property {string} [error]
 * @property {(null | { name: string, parent: number, t: number[], r: number[], s: number[], mesh?: number, materials?: number[], geometryToNode?: number[] })[]} nodes
 * @property {{ name: string, parts: { slot: number, positions: number[], normals?: number[], uv0?: number[], uv1?: number[], colors?: number[], indices: number[], sources: number[] }[], targets: { name: string, channel: number, weight: number, positions?: number[], normals?: number[] }[], skinWeights?: number[], joints?: number[], inverseBind?: number[] }[]} meshes
 * @property {(Record<string, MaterialMap> & { name: string, shader: number, pbr: boolean, doubleSided: boolean })[]} materials
 * @property {{ name: string, file: string, relative: string, absolute: string, content?: number[], transform?: number[], wrapU: number, wrapV: number }[]} textures
 * @property {{ name: string, duration: number, nodes: { node: number, t: Keys, r: Keys, s: Keys }[], weights: { channel: number, keys: Keys }[] }[]} clips
 * @property {number} cameras
 * @property {number} lights
 */

/** @typedef {{ times: number[], values: number[] }} Keys */

/**
 * Reads an FBX file, or an OBJ file with its MTL file's bytes.
 *
 * @param {Uint8Array} bytes
 * @param {{ obj: boolean, mtl?: Uint8Array }} kind
 * @returns {Promise<{ scene: UfbxScene, bin: Uint8Array }>}
 */
export async function readUfbx(bytes, kind) {
	const ufbx = await loadReader();
	const copyIn = (/** @type {Uint8Array} */ data) => {
		const at = ufbx.n3d_alloc(Math.max(1, data.length));
		if (!at) throw new Error('the reader ran out of memory');
		new Uint8Array(ufbx.memory.buffer, at, data.length).set(data);
		return at;
	};
	const file = copyIn(bytes);
	const mtl = kind.mtl ? copyIn(kind.mtl) : 0;
	try {
		const result = ufbx.n3d_convert(
			file,
			bytes.length,
			mtl,
			kind.mtl?.length ?? 0,
			kind.obj ? 1 : 0,
			BAKE_RATE,
		);
		const [json = 0, jsonLength = 0, bin = 0, binLength = 0] = new Uint32Array(
			ufbx.memory.buffer,
			result,
			4,
		);
		const memory = new Uint8Array(ufbx.memory.buffer);
		const scene = JSON.parse(
			new TextDecoder().decode(memory.subarray(/** @type {number} */ (json), json + jsonLength)),
		);
		if (scene.error) throw new Error(scene.error);
		return { scene, bin: memory.slice(/** @type {number} */ (bin), bin + binLength) };
	} finally {
		ufbx.n3d_release();
		ufbx.n3d_free(file);
		if (mtl) ufbx.n3d_free(mtl);
	}
}

/**
 * The texture files that a file names, by where it sits: the name as the file gives it, from its
 * folder, then the bare name in its folder.
 *
 * @param {string} folder
 * @param {readonly string[]} names
 */
function candidates(folder, names) {
	const paths = names
		.filter((name) => name !== '')
		.map((name) => name.replaceAll('\\', '/'))
		.flatMap((name) => [
			isAbsolute(name) ? name : resolve(folder, name),
			join(folder, basename(name)),
		]);
	return [...new Set(paths)];
}

/**
 * Builds the glTF document of a scene that the reader gave.
 *
 * @param {UfbxScene} scene
 * @param {Uint8Array} bin
 * @param {string} folder The folder of the source file, where its texture files are.
 * @param {string[]} notes Gets a line for each part that the document leaves out.
 */
export function ufbxDocument(scene, bin, folder, notes) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
	const f32 = (/** @type {number[]} */ [offset, count]) =>
		new Float32Array(bin.buffer, bin.byteOffset + /** @type {number} */ (offset), count);
	const u32 = (/** @type {number[]} */ [offset, count]) =>
		new Uint32Array(bin.buffer, bin.byteOffset + /** @type {number} */ (offset), count);

	const nodes = scene.nodes.map((source) => {
		if (!source) return undefined;
		return doc
			.createNode(source.name)
			.setTranslation(/** @type {[number, number, number]} */ (source.t))
			.setRotation(/** @type {[number, number, number, number]} */ (source.r))
			.setScale(/** @type {[number, number, number]} */ (source.s));
	});
	const root = doc.createScene();
	doc.getRoot().setDefaultScene(root);
	scene.nodes.forEach((source, i) => {
		const node = nodes[i];
		if (!source || !node) return;
		const parent = source.parent >= 0 ? nodes[source.parent] : undefined;
		if (parent) parent.addChild(node);
		else root.addChild(node);
	});

	const textures = textureMaker(doc, scene, bin, folder, notes);
	/** @type {Map<number, Material>} */
	const materials = new Map();
	const material = (/** @type {number} */ id) => {
		let made = materials.get(id);
		if (!made) {
			made = gltfMaterial(
				doc,
				/** @type {UfbxScene['materials'][number]} */ (scene.materials[id]),
				textures,
				notes,
			);
			materials.set(id, made);
		}
		return made;
	};

	/** @type {Map<string, Mesh>} */
	const meshes = new Map();
	/** @type {Map<number, Node[]>} */
	const meshNodes = new Map();
	scene.nodes.forEach((source, i) => {
		const node = /** @type {Node} */ (nodes[i]);
		if (!source || source.mesh === undefined) return;
		const id = source.mesh;
		const data = /** @type {UfbxScene['meshes'][number]} */ (scene.meshes[id]);
		const slots = source.materials ?? [];
		const key = `${id}:${slots.join(',')}`;
		let mesh = meshes.get(key);
		if (!mesh) {
			mesh = gltfMesh(doc, buffer, data, slots.map(material), { f32, u32, view });
			meshes.set(key, mesh);
		}
		node.setMesh(mesh);
		meshNodes.set(id, [...(meshNodes.get(id) ?? []), node]);
		if (data.joints && data.inverseBind)
			node.setSkin(gltfSkin(doc, buffer, data, node, nodes, source, { f32, view }));
	});

	for (const clip of scene.clips) addClip(doc, buffer, scene, clip, nodes, meshNodes, f32);
	if (scene.cameras > 0) notes.push(`${scene.cameras} camera(s) left out`);
	if (scene.lights > 0) notes.push(`${scene.lights} light(s) left out`);
	return doc;
}

/**
 * A glTF mesh of one source mesh, with the materials that its node gives each slot.
 *
 * @param {Document} doc
 * @param {import('@gltf-transform/core').Buffer} buffer
 * @param {UfbxScene['meshes'][number]} data
 * @param {Material[]} slots
 * @param {{ f32: (range: number[]) => Float32Array, u32: (range: number[]) => Uint32Array, view: DataView }} read
 */
function gltfMesh(doc, buffer, data, slots, { f32, u32, view }) {
	const mesh = doc.createMesh(data.name);
	for (const part of data.parts) {
		const sources = u32(part.sources);
		const count = sources.length;
		/** @type {import('./convert-document.js').PrimitiveArrays} */
		const arrays = {
			positions: f32(part.positions).slice(),
			indices: u32(part.indices).slice(),
			material: slots[part.slot] ?? null,
		};
		if (part.normals) arrays.normals = f32(part.normals).slice();
		const uvs = [part.uv0, part.uv1].filter((uv) => uv !== undefined).map((uv) => f32(uv).slice());
		if (uvs.length > 0) arrays.uvs = uvs;
		if (part.colors) arrays.colors = f32(part.colors).slice();
		if (data.skinWeights && data.joints) {
			const joints = new Uint16Array(count * 4);
			const weights = new Float32Array(count * 4);
			const at = /** @type {number} */ (data.skinWeights[0]);
			for (let v = 0; v < count; v++) {
				const record = at + /** @type {number} */ (sources[v]) * 32;
				for (let k = 0; k < 4; k++) {
					joints[v * 4 + k] = view.getUint32(record + k * 4, true);
					weights[v * 4 + k] = view.getFloat32(record + 16 + k * 4, true);
				}
			}
			arrays.joints = data.joints.length < 256 ? Uint8Array.from(joints) : joints;
			arrays.weights = weights;
		}
		if (data.targets.length > 0)
			arrays.targets = data.targets.map((target) => {
				/** @param {number[] | undefined} range */
				const offsets = (range) => {
					if (!range) return undefined;
					const all = f32(range);
					const out = new Float32Array(count * 3);
					for (let v = 0; v < count; v++)
						out.set(
							all.subarray(
								/** @type {number} */ (sources[v]) * 3,
								/** @type {number} */ (sources[v]) * 3 + 3,
							),
							v * 3,
						);
					return out;
				};
				const normals = offsets(target.normals);
				return {
					name: target.name,
					positions: /** @type {Float32Array} */ (
						offsets(target.positions) ?? new Float32Array(count * 3)
					),
					...(normals && { normals }),
				};
			});
		mesh.addPrimitive(createPrimitive(doc, buffer, arrays));
	}
	if (data.targets.length > 0) mesh.setWeights(data.targets.map((target) => target.weight));
	return mesh;
}

/**
 * The skin of a node's skinned mesh. Vertices that no joint moves, and joints without a bone,
 * follow the node: the skin gives them a joint of their own, a new child of the node.
 *
 * @param {Document} doc
 * @param {import('@gltf-transform/core').Buffer} buffer
 * @param {UfbxScene['meshes'][number]} data
 * @param {Node} node
 * @param {(Node | undefined)[]} nodes
 * @param {NonNullable<UfbxScene['nodes'][number]>} source
 * @param {{ f32: (range: number[]) => Float32Array, view: DataView }} read
 */
function gltfSkin(doc, buffer, data, node, nodes, source, { f32, view }) {
	const joints = /** @type {number[]} */ (data.joints);
	const own = source.geometryToNode ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	const [at = 0, vertices = 0] = data.skinWeights ?? [];
	let unweighted = false;
	for (let v = 0; v < vertices && !unweighted; v++)
		unweighted = view.getUint32(at + v * 32, true) === joints.length;
	const count = unweighted ? joints.length + 1 : joints.length;
	const inverse = new Float32Array(count * 16);
	inverse.set(f32(/** @type {number[]} */ (data.inverseBind)));
	const skin = doc.createSkin(data.name);
	/** A new joint under the node, for vertices that follow the node, at the skin's `slot`. */
	const nodeJoint = (/** @type {string} */ name, /** @type {number} */ slot) => {
		const joint = doc.createNode(`${source.name} (${name})`);
		node.addChild(joint);
		inverse.set(own, slot * 16);
		return joint;
	};
	joints.forEach((id, i) => {
		skin.addJoint((id >= 0 && nodes[id]) || nodeJoint('no bone', i));
	});
	if (unweighted) skin.addJoint(nodeJoint('unskinned', joints.length));
	skin.setInverseBindMatrices(accessor(doc, buffer, inverse, 'MAT4'));
	return skin;
}

/**
 * Makes the document's textures from the reader's, each once: a texture with a file, a texture
 * whose file is turned into a normal map from heights, and packed metal-rough maps.
 *
 * @param {Document} doc
 * @param {UfbxScene} scene
 * @param {Uint8Array} bin
 * @param {string} folder
 * @param {string[]} notes
 */
function textureMaker(doc, scene, bin, folder, notes) {
	/** @type {Map<number, { bytes: Uint8Array, name: string } | undefined>} */
	const files = new Map();
	/** The bytes of a texture's file: held in the source file, or found beside it. */
	const file = (/** @type {number} */ id) => {
		if (files.has(id)) return files.get(id);
		const texture = /** @type {UfbxScene['textures'][number]} */ (scene.textures[id]);
		const name = basename((texture.relative || texture.file || texture.name).replaceAll('\\', '/'));
		let found;
		if (texture.content) {
			const [offset, length] = /** @type {[number, number]} */ (texture.content);
			found = { bytes: bin.slice(offset, offset + length), name };
		} else {
			const path = candidates(folder, [texture.relative, texture.file, texture.absolute]).find(
				(candidate) => existsSync(candidate),
			);
			if (path) found = { bytes: new Uint8Array(readFileSync(path)), name: basename(path) };
			else notes.push(`the texture ${name} is not beside the model, so it is left out`);
		}
		files.set(id, found);
		return found;
	};
	/** @type {Map<string, Texture | undefined>} */
	const made = new Map();
	/** A document texture, made once for a key. */
	const once = (/** @type {string} */ key, /** @type {() => Texture | undefined} */ make) => {
		if (!made.has(key)) made.set(key, make());
		return made.get(key);
	};
	/** The pixels of a texture's file, or nothing with a note. */
	const pixels = (/** @type {number} */ id) => {
		const found = file(id);
		if (!found) return undefined;
		try {
			return readPixels(found.bytes, found.name);
		} catch (error) {
			notes.push(`${found.name}: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	};
	const png = (/** @type {string} */ name, /** @type {Uint8Array} */ bytes) =>
		doc.createTexture(name).setImage(bytes).setMimeType('image/png');
	return {
		/** The texture of a file as it is. */
		plain: (/** @type {number} */ id) =>
			once(`plain ${id}`, () => {
				const found = file(id);
				const image = found && gltfImage(found.bytes, found.name, notes);
				if (!found || !image) return undefined;
				return doc.createTexture(found.name).setImage(image.bytes).setMimeType(image.mimeType);
			}),
		/** True when a texture's file is a gray height map. */
		gray: (/** @type {number} */ id) => {
			const image = pixels(id);
			return image !== undefined && isGray(image);
		},
		/** A normal map made from a height map's file. */
		fromHeights: (/** @type {number} */ id, /** @type {number} */ scale) =>
			once(`heights ${id} ${scale}`, () => {
				const found = file(id);
				if (!found) return undefined;
				try {
					const normals = normalsFromHeights(readHeights(found.bytes, found.name), scale, true);
					return png(`${found.name.replace(/\.[^.]*$/, '')}-normal`, encodePng(normals));
				} catch (error) {
					notes.push(`${found.name}: ${error instanceof Error ? error.message : String(error)}`);
					return undefined;
				}
			}),
		/**
		 * Occlusion, roughness and metalness in one texture, from the files that have them. A
		 * channel without a file is white, so the material's factor applies as it is.
		 */
		packed: (/** @type {(number | undefined)[]} */ ids, /** @type {boolean} */ glossiness) =>
			once(`packed ${ids.join(',')} ${glossiness}`, () => {
				/** @type {ChannelSource[]} */
				const channels = [];
				for (const [c, id] of ids.entries()) {
					const image = id === undefined ? undefined : pixels(id);
					channels.push(image ? { image, invert: c === 1 && glossiness } : { value: 255 });
				}
				if (channels.every((channel) => 'value' in channel)) return undefined;
				const packed = packChannels(
					/** @type {[ChannelSource, ChannelSource, ChannelSource]} */ (channels),
				);
				const names = ids.map((id) => (id === undefined ? '' : (file(id)?.name ?? '')));
				const name = names.find((n) => n !== '')?.replace(/\.[^.]*$/, '') ?? 'packed';
				return png(`${name}-orm`, encodePng(packed));
			}),
		/** The texture's coordinates and sampler, which `info` takes. */
		place: (/** @type {number} */ id, /** @type {TextureInfo} */ info) => {
			const texture = /** @type {UfbxScene['textures'][number]} */ (scene.textures[id]);
			if (texture.wrapU === UFBX_CLAMP) info.setWrapS(33071);
			if (texture.wrapV === UFBX_CLAMP) info.setWrapT(33071);
			if (!texture.transform) return;
			const [su = 1, sv = 1, ou = 0, ov = 0, a = 0, b = 0] = texture.transform;
			if (a !== 0 || b !== 0) {
				notes.push(`the texture ${texture.name} turns its coordinates, which is left out`);
				return;
			}
			// The source's V runs up the image and glTF's down, so the offset moves with the scale.
			const transform = doc
				.createExtension(KHRTextureTransform)
				.createTransform()
				.setScale([su, sv])
				.setOffset([ou, 1 - sv - ov]);
			info.setExtension('KHR_texture_transform', transform);
		},
	};
}

/**
 * The roughness that a Phong exponent gives: the Beckmann slope that matches it, as perceptual
 * roughness.
 *
 * @param {number} exponent
 */
export const phongRoughness = (exponent) => Math.sqrt(Math.sqrt(2 / (Math.max(0, exponent) + 2)));

/**
 * A glTF metal-rough material from a source material.
 *
 * @param {Document} doc
 * @param {UfbxScene['materials'][number]} m
 * @param {ReturnType<typeof textureMaker>} textures
 * @param {string[]} notes
 */
function gltfMaterial(doc, m, textures, notes) {
	const material = doc.createMaterial(m.name).setDoubleSided(m.doubleSided);
	const map = (/** @type {string} */ name) => /** @type {MaterialMap} */ (m[name]);
	const value = (/** @type {string} */ name, fallback = 0) =>
		map(name).has ? /** @type {number} */ (map(name).value[0]) : fallback;
	/** Gives a material slot its texture, with the texture's coordinates. */
	const slot = (
		/** @type {Texture | undefined} */ texture,
		/** @type {(texture: Texture) => void} */ set,
		/** @type {() => TextureInfo | null} */ info,
		/** @type {number | undefined} */ id,
	) => {
		if (!texture) return false;
		set(texture);
		const slotInfo = info();
		if (slotInfo && id !== undefined) textures.place(id, slotInfo);
		return true;
	};

	// A texture replaces its map's value, so a textured color takes only the factor.
	const factor = value('baseFactor', 1);
	const base = map('baseColor');
	const baseTexture = base.texture === undefined ? undefined : textures.plain(base.texture);
	const color = baseTexture ? [1, 1, 1] : base.has ? base.value.slice(0, 3) : [1, 1, 1];
	let alpha = 1;
	if (map('opacity').has) alpha = value('opacity', 1);
	else if (map('transparencyFactor').has && map('transparency').has) {
		const [r = 0, g = 0, b = 0] = map('transparency').value;
		alpha = 1 - value('transparencyFactor') * ((r + g + b) / 3);
	}
	material.setBaseColorFactor([
		/** @type {number} */ (color[0]) * factor,
		/** @type {number} */ (color[1]) * factor,
		/** @type {number} */ (color[2]) * factor,
		alpha,
	]);
	slot(
		baseTexture,
		(t) => material.setBaseColorTexture(t),
		() => material.getBaseColorTextureInfo(),
		base.texture,
	);
	const alphaTexture = map('opacity').texture ?? map('transparency').texture;
	const alphaFromBase =
		alphaTexture !== undefined &&
		base.texture !== undefined &&
		textures.plain(alphaTexture) === textures.plain(base.texture);
	if (alphaTexture !== undefined && !alphaFromBase)
		notes.push(`${m.name}'s opacity map is not its color map's alpha, so it is left out`);
	if (alpha < 1 || alphaFromBase) material.setAlphaMode('BLEND');

	// Roughness and metalness, from the maps or from a Phong exponent.
	const roughnessId = map('roughness').texture;
	const glossId = roughnessId === undefined ? map('glossiness').texture : undefined;
	const metalId = map('metalness').texture;
	const occlusionId = map('occlusion').texture;
	let roughness = map('roughness').has
		? value('roughness')
		: map('glossiness').has
			? 1 - value('glossiness')
			: 1;
	if (
		(m.shader === FBX_PHONG || (m.shader === WAVEFRONT_MTL && !m.pbr)) &&
		map('specularExponent').has
	)
		roughness = phongRoughness(value('specularExponent'));
	const roughId = roughnessId ?? glossId;
	if (roughId !== undefined || metalId !== undefined) {
		const packed = textures.packed([occlusionId, roughId, metalId], glossId !== undefined);
		if (packed) {
			material.setMetallicRoughnessTexture(packed);
			if (occlusionId !== undefined) material.setOcclusionTexture(packed);
		}
	} else if (occlusionId !== undefined) {
		slot(
			textures.plain(occlusionId),
			(t) => material.setOcclusionTexture(t),
			() => material.getOcclusionTextureInfo(),
			occlusionId,
		);
	}
	material.setRoughnessFactor(roughId !== undefined ? 1 : roughness);
	material.setMetallicFactor(metalId !== undefined ? 1 : value('metalness'));
	const packedInfo = material.getMetallicRoughnessTextureInfo();
	const placeFrom = roughId ?? metalId;
	if (packedInfo && placeFrom !== undefined) textures.place(placeFrom, packedInfo);
	const occlusionInfo = material.getOcclusionTextureInfo();
	if (occlusionInfo && occlusionId !== undefined && material.getMetallicRoughnessTexture())
		textures.place(placeFrom ?? occlusionId, occlusionInfo);

	// A normal map, or one made from a bump map's heights. A gray normal map is a bump map too,
	// as OBJ files often name one.
	const normalId = map('normal').texture;
	const bumpScale = map('bumpFactor').has ? value('bumpFactor', 1) || 1 : 1;
	if (normalId !== undefined && !textures.gray(normalId))
		slot(
			textures.plain(normalId),
			(t) => material.setNormalTexture(t),
			() => material.getNormalTextureInfo(),
			normalId,
		);
	else {
		const heightId = normalId ?? map('bump').texture;
		if (heightId !== undefined)
			slot(
				textures.fromHeights(heightId, bumpScale),
				(t) => material.setNormalTexture(t),
				() => material.getNormalTextureInfo(),
				heightId,
			);
	}

	// Emission: the color times its factor, which a texture replaces.
	const emission = map('emission');
	const emissionFactor = value('emissionFactor', 1);
	const emissionTexture =
		emission.texture === undefined ? undefined : textures.plain(emission.texture);
	const glow = (
		emissionTexture ? [1, 1, 1] : emission.has ? emission.value.slice(0, 3) : [0, 0, 0]
	).map((c) => c * emissionFactor);
	const peak = Math.max(...glow);
	if (peak > 1) {
		material.setEmissiveFactor(/** @type {[number, number, number]} */ (glow.map((c) => c / peak)));
		material.setExtension(
			'KHR_materials_emissive_strength',
			doc
				.createExtension(KHRMaterialsEmissiveStrength)
				.createEmissiveStrength()
				.setEmissiveStrength(peak),
		);
	} else material.setEmissiveFactor(/** @type {[number, number, number]} */ (glow));
	slot(
		emissionTexture,
		(t) => material.setEmissiveTexture(t),
		() => material.getEmissiveTextureInfo(),
		emission.texture,
	);
	return material;
}

/**
 * Adds a clip: each node's keys, and each morphed mesh's weights on every node that shows it.
 * glTF keeps one track of all of a mesh's weights, so the weights of each target take the times
 * of all, between their own keys by straight lines.
 *
 * @param {Document} doc
 * @param {import('@gltf-transform/core').Buffer} buffer
 * @param {UfbxScene} scene
 * @param {UfbxScene['clips'][number]} clip
 * @param {(Node | undefined)[]} nodes
 * @param {Map<number, Node[]>} meshNodes
 * @param {(range: number[]) => Float32Array} f32
 */
function addClip(doc, buffer, scene, clip, nodes, meshNodes, f32) {
	const animation = doc.createAnimation(clip.name);
	const channel = (
		/** @type {Node} */ node,
		/** @type {'translation' | 'rotation' | 'scale' | 'weights'} */ path,
		/** @type {Float32Array} */ times,
		/** @type {Float32Array} */ values,
		/** @type {'SCALAR' | 'VEC3' | 'VEC4'} */ type,
	) => {
		const sampler = doc
			.createAnimationSampler()
			.setInput(accessor(doc, buffer, times, 'SCALAR'))
			.setOutput(accessor(doc, buffer, values, type))
			.setInterpolation('LINEAR');
		animation.addSampler(sampler);
		animation.addChannel(
			doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
		);
	};
	for (const track of clip.nodes) {
		const node = nodes[track.node];
		if (!node) continue;
		channel(node, 'translation', f32(track.t.times), f32(track.t.values), 'VEC3');
		channel(node, 'rotation', f32(track.r.times), f32(track.r.values), 'VEC4');
		channel(node, 'scale', f32(track.s.times), f32(track.s.values), 'VEC3');
	}
	scene.meshes.forEach((mesh, id) => {
		const tracks = mesh.targets.map((target) =>
			clip.weights.find((weights) => weights.channel === target.channel),
		);
		if (tracks.every((track) => track === undefined)) return;
		const times = [
			...new Set(tracks.flatMap((track) => (track ? [...f32(track.keys.times)] : []))),
		].sort((a, b) => a - b);
		const values = new Float32Array(times.length * mesh.targets.length);
		tracks.forEach((track, t) => {
			const keyTimes = track ? f32(track.keys.times) : undefined;
			const keyValues = track ? f32(track.keys.values) : undefined;
			times.forEach((time, k) => {
				values[k * mesh.targets.length + t] =
					keyTimes && keyValues
						? sampleLinear(keyTimes, keyValues, time) / 100
						: /** @type {{ weight: number }} */ (mesh.targets[t]).weight;
			});
		});
		for (const node of meshNodes.get(id) ?? [])
			channel(node, 'weights', Float32Array.from(times), values, 'SCALAR');
	});
}

/**
 * A track's value at a time, between its keys by a straight line, and held past its ends.
 *
 * @param {Float32Array} times
 * @param {Float32Array} values
 * @param {number} time
 */
export function sampleLinear(times, values, time) {
	const last = times.length - 1;
	if (last < 0) return 0;
	if (time <= /** @type {number} */ (times[0])) return /** @type {number} */ (values[0]);
	if (time >= /** @type {number} */ (times[last])) return /** @type {number} */ (values[last]);
	let k = 0;
	while (/** @type {number} */ (times[k + 1]) < time) k++;
	const t0 = /** @type {number} */ (times[k]);
	const t1 = /** @type {number} */ (times[k + 1]);
	const v0 = /** @type {number} */ (values[k]);
	const v1 = /** @type {number} */ (values[k + 1]);
	return t1 > t0 ? v0 + ((v1 - v0) * (time - t0)) / (t1 - t0) : v1;
}

/**
 * The bytes of the MTL files that an OBJ file names, joined, from the OBJ file's folder. A file
 * that is missing gets a note.
 *
 * @param {Uint8Array} obj
 * @param {string} folder
 * @param {string[]} notes
 */
export function mtlFiles(obj, folder, notes) {
	const text = new TextDecoder().decode(obj);
	const names = [...text.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)].map(
		(match) => /** @type {string} */ (match[1]),
	);
	/** @type {Uint8Array[]} */
	const parts = [];
	for (const name of names) {
		const path = candidates(folder, [name]).find((candidate) => existsSync(candidate));
		if (path) parts.push(new Uint8Array(readFileSync(path)), new Uint8Array([10]));
		else
			notes.push(`the material file ${name} is not beside the model, so its materials are plain`);
	}
	if (parts.length === 0) return undefined;
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
