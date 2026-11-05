// Prints each node of an optimized model: its transform, its mesh's triangles, its levels with
// their errors, and the pieces of each level.
import { glTFIO } from '../../../../packages/cli/src/assets/pipeline.js';

const io = await glTFIO();
const tri = (m: any) =>
	m.listPrimitives().reduce((s: number, p: any) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0);
const pcs = (m: any) =>
	m
		.listPrimitives()
		.map((p: any) => (p.getExtension('NULL3D_pieces') as any)?.getTriangles()?.length ?? 0)
		.join('/');
for (const path of process.argv.slice(2)) {
	const doc = await io.read(path);
	const levelNodes = new Set<any>();
	for (const node of doc.getRoot().listNodes()) {
		const lod = node.getExtension('MSFT_lod') as any;
		if (lod) for (const n of lod.listLevels()) levelNodes.add(n);
	}
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh();
		if (!mesh || levelNodes.has(node)) continue;
		const lod = node.getExtension('MSFT_lod') as any;
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
				.map((p: any) =>
					p
						.listExtensions()
						.map((e: any) => e.extensionName)
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
					.map(
						(n: any, j: number) =>
							`${tri(n.getMesh())}[${pcs(n.getMesh())}]e${errs?.[j]?.toPrecision(3)}`,
					)
					.join(' '),
			);
		}
	}
}
