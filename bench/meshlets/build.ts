// Writes the desert's meshes as glTF files of float vertices with no compression, which the
// three.js page loads as they are: the ground in one file and every other mesh in another. Then
// runs null3D's asset tool on each. The ground, drawn once, gets levels and a cluster tree. The
// other meshes, which the pages copy many times, get levels alone: a mesh with many copies draws
// whole levels, and the tool's own simplification makes deeper levels than the cuts of a tree.
// Every file lands in target/meshlets, beside the three.js build that the three.js page imports.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '../../packages/cli/node_modules/@gltf-transform/core';
import { MATERIALS, MESHES } from './desert.js';

const root = join(import.meta.dirname, '../..');
const out = join(root, 'target/meshlets');
// MESHLETS_CLI names another checkout, whose asset tool then writes the null3D files into the
// folder that MESHLETS_NULL3D_OUT names, so an asset-tool change can be measured on the same scene.
const cliRoot = process.env.MESHLETS_CLI ?? root;
const null3dOut = process.env.MESHLETS_NULL3D_OUT ?? join(out, 'null3d');

/** The files: their name, the meshes they hold and the asset tool's options for them. */
const FILES = [
	{ name: 'ground', meshes: ['ground'], options: ['--lod', '--clusters'] },
	{
		name: 'props',
		meshes: MESHES.map((m) => m.name).filter((n) => n !== 'ground'),
		options: ['--lod'],
	},
];

for (const file of FILES) {
	const raw = join(out, 'raw', file.name);
	const optimized = join(null3dOut, file.name);
	mkdirSync(raw, { recursive: true });
	const document = new Document();
	const buffer = document.createBuffer();
	const scene = document.createScene(file.name);
	const materials = new Map();
	for (const { name, material, build } of MESHES.filter((m) => file.meshes.includes(m.name))) {
		let gltfMaterial = materials.get(material);
		if (!gltfMaterial) {
			const { color, roughness } = MATERIALS[material];
			gltfMaterial = document
				.createMaterial(material)
				.setBaseColorFactor([color[0], color[1], color[2], 1])
				.setRoughnessFactor(roughness)
				.setMetallicFactor(0);
			materials.set(material, gltfMaterial);
		}
		const { positions, normals, indices } = build();
		const accessor = (type: 'VEC3' | 'SCALAR', array: Float32Array | Uint32Array) =>
			document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
		const primitive = document
			.createPrimitive()
			.setAttribute('POSITION', accessor('VEC3', positions))
			.setAttribute('NORMAL', accessor('VEC3', normals))
			.setIndices(accessor('SCALAR', indices))
			.setMaterial(gltfMaterial);
		scene.addChild(
			document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)),
		);
	}
	await new NodeIO().write(join(raw, `${file.name}.glb`), document);
	console.log(`wrote ${join(raw, `${file.name}.glb`)}`);
	rmSync(optimized, { recursive: true, force: true });
	execFileSync(
		'bun',
		[
			join(cliRoot, 'packages/cli/bin/null3d.js'),
			'assets',
			'optimize',
			raw,
			optimized,
			...file.options,
			'--no-blockers',
			'--bvh',
			'0',
		],
		{ stdio: 'inherit', cwd: cliRoot },
	);
}
