// A screen that follows a video element on the page, which `engine.registerVideo` sends frames of.
// The screen covers the left half of the view. The right half shows a data texture of the same
// grey, so a capture compares the video's frame with the colour that it should hold, both drawn by
// the same kind of material on the same path. The page times the frames while the video plays and
// while it is paused, so a run reports what a frame costs and that a paused video costs nothing.
import { defineSketch, type MeshArrays, type Texture } from '@null3d/engine';

/** The name that the page registers the video under, which this screen follows. */
const NAME = 'video-test';

/** The grey that the page paints into the video, and that the right half shows from data. */
const GREY = 128;

/** A quad of the view, from `left` to `right` in x, with the texture the right way up. */
function quad(left: number, right: number): MeshArrays {
	return {
		positions: [left, -1, 0, right, -1, 0, right, 1, 0, left, 1, 0],
		normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
		uvs: [0, 0, 1, 0, 1, 1, 0, 1],
		indices: [0, 1, 2, 0, 2, 3],
	};
}

export default defineSketch(({ scene, geometry, materials, textures, page, quality }) => {
	scene.setBackground('#101010');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 20, position: [0, 0, 2.6] }),
	);
	// The frame that the test reads draws at the canvas's full size, whatever the machine's speed,
	// so every device captures the same picture.
	quality.set({ minRenderScale: 1, maxRenderScale: 1 });
	// The video's frames arrive from the page, and the first one gives the texture its size. No mip
	// levels, so each frame costs one upload and no GPU pass.
	const screen: Texture = textures.fromVideo(NAME, { mipmaps: false });
	const grey = textures.fromData({
		width: 1,
		height: 1,
		colorSpace: 'srgb',
		data: new Uint8Array([GREY, GREY, GREY, 255]),
	});
	// Tone mapping is the same on both halves, so a capture compares the two colours as they are.
	const shown = materials.unlit({ map: screen, toneMapped: false });
	const reference = materials.unlit({ map: grey, toneMapped: false });
	scene.createMesh({ mesh: geometry.fromArrays(quad(-1, 0)), material: shown });
	scene.createMesh({ mesh: geometry.fromArrays(quad(0, 1)), material: reference });

	let reported = false;
	return {
		onUpdate() {
			if (reported) return;
			reported = true;
			page.post('ready', { budget: textures.uploadBudget });
		},
	};
});
