// Morphed objects for the allocation check: spheres of the morph target scene (bench/scenes/morph.ts)
// in a row in front of S1's boxes. Each frame, the sketch sets all three weights of every sphere,
// as a face's expressions change, so both GPU paths upload new weights and grow new bounds in every
// frame, and WebGL2 caps them.
import type { Mesh, SketchContext } from '@null3d/engine';
import { morphMesh, TARGET_NAMES } from '../../scenes/morph';

/** Reads the morphed object count from the sketch module's address, or 0 for none. */
export function readMorphed(moduleUrl: string): number {
	return Number(new URL(moduleUrl).searchParams.get('morphed') ?? '0');
}

/**
 * Adds `count` morphed spheres, and returns the code that sets their weights in each frame at
 * sketch time `t`.
 */
export function createMorphedRow(
	{ scene, geometry, materials }: SketchContext,
	count: number,
): (t: number) => void {
	if (count === 0) return () => {};
	const { positions, normals, indices, positionDeltas, normalDeltas } = morphMesh();
	const mesh = geometry.fromArrays({
		positions,
		normals,
		indices,
		morphTargets: { positions: positionDeltas, normals: normalDeltas },
	});
	const material = materials.standard({ color: '#4a8cff' });
	const spheres: Mesh[] = [];
	for (let k = 0; k < count; k++) {
		const position: [number, number, number] = [(k % 16) * 2 - 15, 2, 10 + Math.floor(k / 16) * 2];
		spheres.push(scene.createMesh({ mesh, material, position, name: `face${k}` }));
	}
	return (t) => {
		for (let k = 0; k < spheres.length; k++) {
			const sphere = spheres[k] as Mesh;
			for (let target = 0; target < TARGET_NAMES.length; target++)
				sphere.setMorphWeight(target, 0.5 + 0.5 * Math.sin(t + k + target));
		}
	};
}
