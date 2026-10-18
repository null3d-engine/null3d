// The three.js twin of the outline's scene (bench/scenes/outline.ts), which null3D's image tests
// draw. It draws one frame with an EffectComposer: a RenderPass, an OutlinePass with the scene's
// outlined shapes as its selected objects, an OutputPass, which applies the AgX tone mapping that
// null3D's page sets, and a ShaderPass that draws null3D's crisp line from OutlinePass's
// mask, with the settings that ?outline=plain or ?outline=hidden names. The OutlinePass has no
// strength, so its own soft edges add nothing: it serves only for its mask, so the comparison
// checks which parts the mask counts as hidden, and where the line falls. The last pass draws into
// the canvas, which the page reads back at once and publishes. The composer's targets have no
// MSAA, so null3D's page draws with ?antialias=none. Only WebGLRenderer draws it: WebGPURenderer's
// outline is a node of its own.
import * as three from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	OUTLINE_AMBIENT,
	OUTLINE_BACKGROUND,
	OUTLINE_CAMERA,
	OUTLINE_IMAGE,
	OUTLINE_SETTINGS,
	OUTLINE_SHAPES,
	OUTLINE_SUN,
	type OutlineName,
} from '../../scenes/outline';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { packRows } from '../lib/pixels';

/** The sun's distance from the origin. Its light travels from there toward the origin. */
const SUN_DISTANCE = 10;

/**
 * null3D's crisp line over display color, from OutlinePass's mask, which the caller sets on the
 * built pass: a ShaderPass copies its uniforms, and the copy drops a render target's texture. The
 * mask is white where no selected object covers it, and a selected object writes 0 in red and 1
 * in green where other objects hide it, so coverage is 1 minus red and the visible parts are 1
 * minus green. The line then follows null3D's final pass: the highest coverage at 8 places on a
 * circle of the width.
 */
function crispLine(outline: (typeof OUTLINE_SETTINGS)[OutlineName]) {
	const { width, height } = OUTLINE_IMAGE;
	return {
		uniforms: {
			tDiffuse: { value: null },
			maskTexture: { value: null },
			texel: { value: new three.Vector2(1 / width, 1 / height) },
			width: { value: outline.width },
			color: { value: displayColor(outline.color) },
			hiddenColor: { value: displayColor(outline.hiddenColor || outline.color) },
			hidden: { value: outline.hiddenColor === false ? 0 : 1 },
		},
		vertexShader: `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}`,
		fragmentShader: `
		uniform sampler2D tDiffuse;
		uniform sampler2D maskTexture;
		uniform vec2 texel;
		uniform float width;
		uniform vec3 color;
		uniform vec3 hiddenColor;
		uniform float hidden;
		varying vec2 vUv;
		vec2 maskAt(vec2 uv) {
			return 1.0 - texture2D(maskTexture, uv).rg;
		}
		void main() {
			vec4 base = texture2D(tDiffuse, vUv);
			float inside = maskAt(vUv).x;
			vec2 across = vec2(width * texel.x, 0.0);
			vec2 down = vec2(0.0, width * texel.y);
			vec2 diagonal = (across + down) * 0.70710678;
			vec2 slant = (across - down) * 0.70710678;
			vec2 found = max(maskAt(vUv + across), maskAt(vUv - across));
			found = max(found, max(maskAt(vUv + down), maskAt(vUv - down)));
			found = max(found, max(maskAt(vUv + diagonal), maskAt(vUv - diagonal)));
			found = max(found, max(maskAt(vUv + slant), maskAt(vUv - slant)));
			float line = max(found.y, found.x * hidden) * (1.0 - inside);
			float shown = found.y / max(found.x, 0.0001);
			vec3 lineColor = mix(hiddenColor, color, shown);
			gl_FragColor = base * (1.0 - line) + vec4(lineColor, 1.0) * line;
		}`,
	};
}

/** A color's display components, from a hex string in sRGB. */
function displayColor(hex: string): three.Vector3 {
	const { r, g, b } = new three.Color(hex).convertLinearToSRGB();
	return new three.Vector3(r, g, b);
}

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const name = readChoice(params, 'outline', Object.keys(OUTLINE_SETTINGS) as OutlineName[]);
	const settings = OUTLINE_SETTINGS[name];
	const { width, height } = OUTLINE_IMAGE;
	const renderer = new three.WebGLRenderer({ preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);
	renderer.toneMapping = three.AgXToneMapping;

	const scene = new three.Scene();
	scene.background = new three.Color(OUTLINE_BACKGROUND);
	const sun = new three.DirectionalLight(OUTLINE_SUN.color, OUTLINE_SUN.intensity);
	const [dx, dy, dz] = OUTLINE_SUN.direction;
	sun.position.set(-dx, -dy, -dz).normalize().multiplyScalar(SUN_DISTANCE);
	scene.add(sun);
	scene.add(new three.AmbientLight(OUTLINE_AMBIENT.color, OUTLINE_AMBIENT.intensity));
	const selected: three.Object3D[] = [];
	for (const shape of OUTLINE_SHAPES) {
		const [x, y, z] = shape.size;
		const geometry =
			shape.kind === 'box' ? new three.BoxGeometry(x, y, z) : new three.SphereGeometry(x, 32, 16);
		const material = new three.MeshStandardMaterial({
			color: shape.color,
			roughness: 0.7,
			metalness: 0,
		});
		const mesh = new three.Mesh(geometry, material);
		mesh.position.set(...shape.position);
		scene.add(mesh);
		if (shape.outlined) selected.push(mesh);
	}
	const { position, target, fov, near, far } = OUTLINE_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const composer = new EffectComposer(renderer);
	composer.setPixelRatio(1);
	composer.setSize(width, height);
	composer.addPass(new RenderPass(scene, camera));
	const mask = new OutlinePass(new three.Vector2(width, height), scene, camera, selected);
	mask.edgeStrength = 0;
	composer.addPass(mask);
	composer.addPass(new OutputPass());
	const line = new ShaderPass(crispLine(settings));
	line.uniforms.maskTexture = { value: mask.renderTargetMaskBuffer.texture };
	composer.addPass(line);
	document.body.append(renderer.domElement);
	composer.render();
	const gl = renderer.getContext();
	const bottomFirst = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
	const pixels = packRows(bottomFirst, width, height, width * 4, true);
	return {
		scene: `outline-${name}`,
		renderer: 'webgl',
		n: OUTLINE_SHAPES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
