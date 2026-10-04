// The lines' scenes (bench/scenes/lines.ts) as null3D draws them, for the sketches of the wide
// lines and the one-pixel lines. The three.js twins draw with no tone mapping, three.js's default,
// so the scene turns off the engine's ACES.
import { color, type SketchContext } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	LINE_BOXES,
	LINE_CAMERA,
	type LineSpec,
	SUN,
} from '../../../bench/scenes/lines';

/** Builds the scene with the boxes and `lines`, each one line batch. */
export async function drawLineScene(
	{ scene, materials, geometry, post }: SketchContext,
	lines: readonly LineSpec[],
): Promise<void> {
	post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	const { fov, near, far, position, target } = LINE_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));
	for (const { size, position: center, color: paint } of LINE_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color: paint }),
			position: center,
		});
	}
	const linear = [0, 0, 0];
	for (const line of lines) {
		const colors = line.pointColors?.flatMap((hex) => {
			color.fromHex(linear, hex);
			return [linear[0] ?? 0, linear[1] ?? 0, linear[2] ?? 0];
		});
		await scene.createLines({
			positions: line.points,
			colors,
			mode: line.mode,
			color: line.color,
			width: line.width,
			worldUnits: line.worldUnits,
			dashed: line.dashes !== undefined,
			...line.dashes,
			opacity: line.opacity,
			alphaMode: line.opacity === undefined ? 'opaque' : 'blend',
		});
	}
}
