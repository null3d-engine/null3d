// The see-through solids' scene (bench/scenes/transparency.ts), which the parity test also draws with
// three.js: double-sided solids that blend, whose back faces must draw before their front faces, and
// an open tube that draws both faces in one draw with forceSinglePass.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	GLASS_BOXES,
	GLASS_CAMERA,
	GLASS_SOLID_SEGMENTS,
	GLASS_SOLIDS,
	type GlassSolid,
	SUN,
} from '../../../bench/scenes/transparency';

export default defineSketch(({ scene, materials, geometry, post }) => {
	// The three.js twin draws with no tone mapping, three.js's default.
	post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	const { fov, near, far, position, target } = GLASS_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));

	for (const { size, position: center, color } of GLASS_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color }),
			position: center,
		});
	}
	const [around, along] = GLASS_SOLID_SEGMENTS;
	const shapeOf = ({ shape, size }: GlassSolid) => {
		if (shape === 'box') return geometry.box({ width: size[0], height: size[1], depth: size[2] });
		if (shape === 'sphere')
			return geometry.sphere({ radius: size[0], widthSegments: around, heightSegments: along });
		return geometry.cylinder({
			radiusTop: size[0],
			radiusBottom: size[0],
			height: size[1],
			radialSegments: around,
			openEnded: true,
		});
	};
	for (const solid of GLASS_SOLIDS) {
		const options = {
			color: solid.color,
			opacity: solid.opacity,
			alphaMode: 'blend',
			doubleSided: true,
			forceSinglePass: solid.singlePass,
		} as const;
		const mesh = scene.createMesh({
			mesh: shapeOf(solid),
			material: solid.lit ? materials.standard(options) : materials.unlit(options),
			position: solid.position,
		});
		mesh.setRotationEuler(0, solid.turn, 0);
	}
	return {};
});
