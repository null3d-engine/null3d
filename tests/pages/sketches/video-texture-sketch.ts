// A screen that follows a video element on the page, which `engine.registerVideo` sends frames of.
// The screen covers the left half of the view. The right half shows two data textures of the same
// colours, one per band, so a capture compares the video's frame with the colours that it should
// hold, band for band, and tells a picture that is upside down from one that is not. Both halves
// are drawn by the same kind of material on the same path. The page times the frames while the
// video plays and while it is paused, so a run reports what a frame costs and that a paused video
// costs nothing.
import { defineSketch, type MeshArrays, type Texture } from '@null3d/engine';

/** The name that the page registers the video under, which this screen follows. */
const NAME = 'video-test';

/** The colours of the video's top band and of its bottom band, which the right half shows from data. */
const TOP = [96, 160, 224] as const;
const BOTTOM = [224, 160, 64] as const;

/** A quad of the view, from `left` to `right` in x and `bottom` to `top` in y. */
function quad(left: number, right: number, bottom: number, top: number): MeshArrays {
	return {
		positions: [left, bottom, 0, right, bottom, 0, right, top, 0, left, top, 0],
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
	const band = (color: readonly number[]) =>
		textures.fromData({
			width: 1,
			height: 1,
			colorSpace: 'srgb',
			data: new Uint8Array([color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, 255]),
		});
	// Tone mapping is the same on both halves, so a capture compares the two colours as they are.
	const shown = materials.unlit({ map: screen, toneMapped: false });
	scene.createMesh({ mesh: geometry.fromArrays(quad(-1, 0, -1, 1)), material: shown });
	const upper = materials.unlit({ map: band(TOP), toneMapped: false });
	const lower = materials.unlit({ map: band(BOTTOM), toneMapped: false });
	scene.createMesh({ mesh: geometry.fromArrays(quad(0, 1, 0, 1)), material: upper });
	scene.createMesh({ mesh: geometry.fromArrays(quad(0, 1, -1, 0)), material: lower });
	page.post('ready', { budget: textures.uploadBudget });

	let reported = false;
	return {
		onUpdate() {
			// The first frame gives the texture its size. A video that never plays keeps it small.
			if (reported || screen.width < 2) return;
			reported = true;
			page.post('frame', { width: screen.width, height: screen.height });
		},
	};
});
