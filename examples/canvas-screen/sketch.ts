// Screens in the world, drawn on OffscreenCanvas objects in the sketch. Each screen is a texture
// that refreshes at 20 Hz, and only the rectangles that changed upload: the big number, the bar and
// the row of lights. The room is a dark wall with a metal frame around each screen.
import { defineSketch, type Texture } from '@null3d/engine';

/** The screen's texture, in texels. */
const SIZE = 512;
/** The rectangles that the sketch paints again, in the canvas's coordinates. */
const NUMBER = { x: 24, y: 150, width: 464, height: 150 };
const BAR = { x: 24, y: 330, width: 464, height: 48 };
const LIGHTS = { x: 24, y: 400, width: 464, height: 40 };

/** Draws the parts of the screen that never change. */
function paintFrame(context: OffscreenCanvasRenderingContext2D, title: string): void {
	context.fillStyle = '#060b12';
	context.fillRect(0, 0, SIZE, SIZE);
	context.strokeStyle = '#0e4a5a';
	context.lineWidth = 3;
	for (let at = 0; at <= SIZE; at += 32) {
		context.beginPath();
		context.moveTo(at, 0);
		context.lineTo(at, SIZE);
		context.moveTo(0, at);
		context.lineTo(SIZE, at);
		context.stroke();
	}
	context.fillStyle = '#1b9fb8';
	context.font = 'bold 30px sans-serif';
	context.textBaseline = 'top';
	context.fillText(title, 24, 96);
}

const glow = (texture: Texture) => ({ map: texture, color: '#9fe8ff' });

export default defineSketch(
	async ({ scene, assets, geometry, materials, textures, time, post }) => {
		scene.setBackground('#05080d');
		// The built-in room lights the metal and shows in its frames, with the lamps as accents.
		scene.setEnvironment(await assets.builtinEnvironment('room'), {
			intensity: 0.5,
			rotation: [0, 2.2, 0],
		});
		const camera = scene.createPerspectiveCamera({
			fov: 42,
			position: [0, 0.2, 7.5],
			target: [0, 0.2, 0],
		});
		scene.setActiveCamera(camera);
		scene.createAmbientLight({ color: '#2a4a66', intensity: 0.5 });
		const lamp = scene.createPointLight({
			color: '#7fd8ff',
			intensity: 14,
			range: 12,
			position: [0, 2.2, 3],
		});
		post.set({ bloom: { intensity: 0.6, threshold: 0.9 } });

		// The wall and the metal frames that hold the screens.
		const wall = materials.standard({ color: '#1a2230', roughness: 0.9, metalness: 0.1 });
		const frame = materials.standard({ color: '#39424f', roughness: 0.35, metalness: 0.9 });
		scene.createMesh({
			mesh: geometry.box(),
			material: wall,
			position: [0, 0.2, -1.2],
			scale: [9, 4.5, 0.3],
		});
		for (const x of [-2.8, 0, 2.8]) {
			scene.createMesh({
				mesh: geometry.plane({ width: 2.75, height: 2.75 }),
				material: frame,
				position: [x, 0.2, -0.98],
			});
		}

		/** A screen of its own, from the painter's title and the value that its number shows. */
		const makeScreen = (x: number, title: string, value: (t: number) => number) => {
			const canvas = new OffscreenCanvas(SIZE, SIZE);
			const context = canvas.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('the canvas has no 2D context');
			paintFrame(context, title);
			const map = textures.fromCanvas(canvas, { refreshHz: 20 });
			scene.createMesh({
				mesh: geometry.plane({ width: 2.5, height: 2.5 }),
				material: materials.unlit(glow(map)),
				position: [x, 0.2, -0.95],
			});
			let shown = '';
			/** Paints the number, the bar and the lights, and refreshes the rectangle that holds them. */
			const paint = (now: number) => {
				const number = value(now);
				const text = number.toFixed(1);
				if (text === shown) return;
				shown = text;
				context.fillStyle = '#060b12';
				context.fillRect(NUMBER.x, NUMBER.y, NUMBER.width, NUMBER.height);
				context.fillStyle = '#bff4ff';
				context.font = 'bold 128px sans-serif';
				context.textBaseline = 'top';
				context.fillText(text, NUMBER.x, NUMBER.y);
				const filled = Math.round(BAR.width * Math.min(1, number / 100));
				context.fillStyle = '#123040';
				context.fillRect(BAR.x, BAR.y, BAR.width, BAR.height);
				context.fillStyle = '#37c8e8';
				context.fillRect(BAR.x, BAR.y, filled, BAR.height);
				for (let k = 0; k < 8; k++) {
					context.fillStyle = k / 8 < number / 100 ? '#37c8e8' : '#123040';
					context.fillRect(LIGHTS.x + k * 58, LIGHTS.y, 50, LIGHTS.height);
				}
				// One rectangle covers every part that changed.
				const left = Math.min(NUMBER.x, BAR.x, LIGHTS.x);
				const top = Math.min(NUMBER.y, BAR.y, LIGHTS.y);
				const right = Math.max(NUMBER.x + NUMBER.width, BAR.x + BAR.width, LIGHTS.x + LIGHTS.width);
				const bottom = Math.max(
					NUMBER.y + NUMBER.height,
					BAR.y + BAR.height,
					LIGHTS.y + LIGHTS.height,
				);
				map.refresh({ x: left, y: top, width: right - left, height: bottom - top });
			};
			// The held frame's picture comes from the setup, since hold mode runs no update.
			paint(0);
			return { update: paint };
		};

		const power = makeScreen(-2.8, 'REACTOR', (now) => 62 + 24 * Math.sin(now * 0.8));
		const load = makeScreen(0, 'SHIELD', (now) => 50 + 40 * Math.sin(now * 1.7 + 1));
		const flow = makeScreen(2.8, 'COOLANT', (now) => 35 + 30 * Math.cos(now * 1.1));

		return {
			onUpdate() {
				power.update(time.now);
				load.update(time.now);
				flow.update(time.now);
				// The lamp breathes, which moves the glow across the metal.
				lamp.setIntensity(12 + 3 * Math.sin(time.now * 2));
			},
		};
	},
);
