// The backgrounds' scenes (bench/scenes/backgrounds.ts), which the parity test also draws with
// three.js. `?bg=sky` draws three.js's sky behind an unlit box, `?bg=environment` an environment
// that blurs, dims and turns behind two spheres that it lights, and `?bg=cubemap` a cube map of six
// pictures. `&ortho` looks through an orthographic camera, whose parallel rays see one color of
// the background. The three.js twin draws with no tone mapping, three.js's default, so the sketch
// turns off the engine's default.
import { defineSketch } from '@null3d/engine';
import {
	BACKGROUND_HDR,
	type BackgroundCamera,
	type BackgroundScene,
	CUBEMAP_CAMERA,
	CUBEMAP_FACES,
	ENVIRONMENT_BACKGROUND,
	ENVIRONMENT_CAMERA,
	ENVIRONMENT_COLOR,
	ENVIRONMENT_SPHERE,
	ENVIRONMENT_SPHERES,
	SKY,
	SKY_BOX,
	SKY_CAMERA,
} from '../../../bench/scenes/backgrounds';
import { sampleEnvironment } from '../../../tools/lib/sample-url';
import { pictureUrl } from '../lib/picture';

const params = new URL(import.meta.url).searchParams;
const bg = (params.get('bg') ?? 'sky') as BackgroundScene;

type Context = Parameters<Parameters<typeof defineSketch>[0]>[0];

/** Looks through `camera`, or through an orthographic camera at its place with `&ortho`. */
function look({ scene }: Context, camera: BackgroundCamera): void {
	const { fov, near, far, position, target } = camera;
	scene.setActiveCamera(
		params.has('ortho')
			? scene.createOrthographicCamera({ height: 4, near, far, position, target })
			: scene.createPerspectiveCamera({ fov, near, far, position, target }),
	);
}

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, assets, post } = ctx;
	post.set({ toneMapping: 'none' });
	scene.setBackground('#20242a');
	if (bg === 'sky') {
		look(ctx, SKY_CAMERA);
		scene.setBackground({ sky: SKY });
		const { size, position, color } = SKY_BOX;
		scene.createMesh({
			mesh: geometry.box({ width: size, height: size, depth: size }),
			material: materials.unlit({ color }),
			position: [...position],
		});
	} else if (bg === 'environment') {
		look(ctx, ENVIRONMENT_CAMERA);
		const env = await assets.loadEnvironment(sampleEnvironment(BACKGROUND_HDR));
		scene.setEnvironment(env);
		scene.setBackground(env, ENVIRONMENT_BACKGROUND);
		const sphere = geometry.sphere(ENVIRONMENT_SPHERE);
		for (const { position, metalness, roughness } of ENVIRONMENT_SPHERES) {
			const material = materials.standard({ color: ENVIRONMENT_COLOR, metalness, roughness });
			scene.createMesh({ mesh: sphere, material, position: [...position] });
		}
	} else {
		look(ctx, CUBEMAP_CAMERA);
		const urls = await Promise.all(CUBEMAP_FACES.map(pictureUrl));
		scene.setBackground(await assets.loadCubemap(urls));
		for (const url of urls) URL.revokeObjectURL(url);
	}
});
