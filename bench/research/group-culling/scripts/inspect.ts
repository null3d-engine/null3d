// Prints each node of an optimized model: its transform, its mesh's triangles, its levels with
// their errors, and the pieces of each level.
import { glTFIO } from '../../../../packages/cli/src/assets/pipeline.js';

/** The part of a primitive that this script reads. */
interface Primitive {
	getIndices(): { getCount(): number } | null;
	getExtension(name: string): unknown;
	listExtensions(): { extensionName: string }[];
}

/** The part of a mesh that this script reads. */
interface Mesh {
	listPrimitives(): Primitive[];
}

/** The part of a node that this script reads. */
interface Node {
	getName(): string;
	getMesh(): Mesh | null;
	getExtension(name: string): unknown;
	getTranslation(): number[];
	getScale(): number[];
	getRotation(): number[];
	getExtras(): Record<string, unknown> | null;
}

/** The MSFT_lod extension's list of levels. */
interface Lod {
	listLevels(): Node[];
}

/** The NULL3D_pieces extension's triangle counts. */
interface Pieces {
	getTriangles(): number[];
}

const io = await glTFIO();
const tri = (m: Mesh | null) =>
	m ? m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0) : 0;
const pcs = (m: Mesh | null) =>
	m
		? m
				.listPrimitives()
				.map((p) => (p.getExtension('NULL3D_pieces') as Pieces | null)?.getTriangles()?.length ?? 0)
				.join('/')
		: '';
for (const path of process.argv.slice(2)) {
	const doc = await io.read(path);
	const levelNodes = new Set<Node>();
	for (const node of doc.getRoot().listNodes() as Node[]) {
		const lod = node.getExtension('MSFT_lod') as Lod | null;
		if (lod) for (const n of lod.listLevels()) levelNodes.add(n);
	}
	for (const node of doc.getRoot().listNodes() as Node[]) {
		const mesh = node.getMesh();
		if (!mesh || levelNodes.has(node)) continue;
		const lod = node.getExtension('MSFT_lod') as Lod | null;
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
					.map((n, j) => `${tri(n.getMesh())}[${pcs(n.getMesh())}]e${errs?.[j]?.toPrecision(3)}`)
					.join(' '),
			);
		}
	}
}
