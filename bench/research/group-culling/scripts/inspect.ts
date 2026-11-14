// Prints each node of an optimized model: its transform, its mesh's triangles, its levels with
// their errors, and the pieces of each level.
import { glTFIO } from '../../../../packages/cli/src/assets/pipeline.js';

/** The parts of a primitive this script reads. */
interface Primitive {
	getIndices(): { getCount(): number } | null;
	getExtension(name: string): { getTriangles?(): readonly unknown[] } | null;
	listExtensions(): { extensionName: string }[];
}

/** The parts of a mesh this script reads. */
interface Mesh {
	listPrimitives(): Primitive[];
}

/** A node's level-of-detail extension, as the optimizer writes it. */
interface Levels {
	listLevels(): { getMesh(): unknown }[];
}

const io = await glTFIO();
const meshOf = (node: { getMesh(): unknown }): Mesh | null => node.getMesh() as Mesh | null;
const tri = (m: Mesh) =>
	m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0);
const pcs = (m: Mesh) =>
	m
		.listPrimitives()
		.map((p) => p.getExtension('NULL3D_pieces')?.getTriangles()?.length ?? 0)
		.join('/');
for (const path of process.argv.slice(2)) {
	const doc = await io.read(path);
	const levelNodes = new Set<unknown>();
	for (const node of doc.getRoot().listNodes()) {
		const lod = node.getExtension('MSFT_lod') as Levels | null;
		if (lod) for (const n of lod.listLevels()) levelNodes.add(n);
	}
	for (const node of doc.getRoot().listNodes()) {
		const mesh = meshOf(node);
		if (!mesh || levelNodes.has(node)) continue;
		const lod = node.getExtension('MSFT_lod') as Levels | null;
		console.log(
			node.getName(),
			'T',
			node
				.getTranslation()
				.map((v: number) => v.toFixed(3))
				.join(','),
			'S',
			node
				.getScale()
				.map((v: number) => v.toFixed(6))
				.join(','),
			'R',
			node
				.getRotation()
				.map((v: number) => v.toFixed(3))
				.join(','),
			'tris',
			tri(mesh),
			'prims',
			mesh.listPrimitives().length,
			'pieces',
			pcs(mesh),
			'ext',
			mesh
				.listPrimitives()
				.map((p) =>
					p
						.listExtensions()
						.map((e) => e.extensionName)
						.join('+'),
				)
				.join(' '),
		);
		if (lod) {
			const errs = node.getExtras()?.NULL3D_lod_error as number[] | undefined;
			console.log(
				'   levels',
				lod
					.listLevels()
					.map((n, j) => {
						const m = meshOf(n);
						return `${m ? tri(m) : 0}[${m ? pcs(m) : 0}]e${errs?.[j]?.toPrecision(3)}`;
					})
					.join(' '),
			);
		}
	}
}
