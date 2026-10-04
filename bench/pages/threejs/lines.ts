// The three.js twin of the lines' scenes (bench/scenes/lines.ts), which null3D's image tests draw.
// By default it draws the wide lines: each line is a `Line2`, or a `LineSegments2` for pairs of
// points, with a `LineMaterial` of its own on WebGLRenderer and a `Line2NodeMaterial` on
// WebGPURenderer. A loop draws as a strip that ends at its first point. With `?basic`, it draws the
// one-pixel lines: a `Line`, `LineSegments` or `LineLoop` with a `LineBasicMaterial`, or a
// `LineDashedMaterial` for the dashed line. It draws the scene once into an offscreen target of the
// image's size, and publishes the pixels as the hold pages do. `?renderer=webgl` draws with
// WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import type * as ThreeModule from 'three';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	BASIC_LINE_COUNT,
	BASIC_LINES,
	closedLoop,
	LINE_BOXES,
	LINE_CAMERA,
	LINE_IMAGE,
	type LineSpec,
	WIDE_LINE_COUNT,
	WIDE_LINES,
} from '../../scenes/lines';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree, type Three } from './harness';

const params = new URLSearchParams(location.search);

/** The linear colors of a line's points, 3 numbers each, or none. */
function pointColors(three: Three, line: LineSpec): number[] | undefined {
	const colors = line.pointColors?.flatMap((hex) => new three.Color(hex).toArray());
	return colors && line.mode === 'loop' ? closedLoop(colors) : colors;
}

/** The options of a wide line's material, which both materials take. */
function wideMaterialOptions(line: LineSpec, colors: number[] | undefined) {
	return {
		color: colors ? '#ffffff' : line.color,
		linewidth: line.width,
		worldUnits: line.worldUnits ?? false,
		vertexColors: colors !== undefined,
		dashed: line.dashes !== undefined,
		...line.dashes,
		transparent: line.opacity !== undefined,
		opacity: line.opacity ?? 1,
	};
}

/** A wide line, drawn by the line classes of the renderer that `rendererName` names. */
async function wideLine(
	three: Three,
	rendererName: (typeof RENDERERS)[number],
	line: LineSpec,
): Promise<ThreeModule.Object3D> {
	const points = line.mode === 'loop' ? closedLoop(line.points) : [...line.points];
	const colors = pointColors(three, line);
	const pairs = line.mode === 'segments';
	const { LineGeometry } = await import('three/addons/lines/LineGeometry.js');
	const { LineSegmentsGeometry } = await import('three/addons/lines/LineSegmentsGeometry.js');
	const strip = new LineGeometry();
	const geometry = pairs ? new LineSegmentsGeometry() : strip;
	geometry.setPositions(points);
	if (colors) geometry.setColors(colors);
	const options = wideMaterialOptions(line, colors);
	let object: { computeLineDistances(): unknown } & ThreeModule.Object3D;
	if (rendererName === 'webgpu') {
		const { Line2NodeMaterial } = await import('three/webgpu');
		const { Line2 } = await import('three/addons/lines/webgpu/Line2.js');
		const { LineSegments2 } = await import('three/addons/lines/webgpu/LineSegments2.js');
		const material = new Line2NodeMaterial(options);
		object = pairs ? new LineSegments2(geometry, material) : new Line2(strip, material);
	} else {
		const { LineMaterial } = await import('three/addons/lines/LineMaterial.js');
		const { Line2 } = await import('three/addons/lines/Line2.js');
		const { LineSegments2 } = await import('three/addons/lines/LineSegments2.js');
		const material = new LineMaterial(options);
		object = pairs ? new LineSegments2(geometry, material) : new Line2(strip, material);
	}
	if (line.dashes) object.computeLineDistances();
	return object;
}

/** A one-pixel line, as three.js's line classes draw it. */
function basicLine(three: Three, line: LineSpec): ThreeModule.Object3D {
	const geometry = new three.BufferGeometry();
	geometry.setAttribute('position', new three.Float32BufferAttribute([...line.points], 3));
	const colors = line.pointColors?.flatMap((hex) => new three.Color(hex).toArray());
	if (colors) geometry.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
	const color = colors ? '#ffffff' : line.color;
	const material = line.dashes
		? new three.LineDashedMaterial({
				color,
				vertexColors: colors !== undefined,
				dashSize: line.dashes.dashSize,
				gapSize: line.dashes.gapSize,
				scale: line.dashes.dashScale,
			})
		: new three.LineBasicMaterial({ color, vertexColors: colors !== undefined });
	const kind = { segments: three.LineSegments, strip: three.Line, loop: three.LineLoop }[line.mode];
	const object = new kind(geometry, material);
	if (line.dashes) object.computeLineDistances();
	return object;
}

showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const basic = params.has('basic');
	const { three, renderer, readFrame } = await startThree(rendererName);
	const { width, height } = LINE_IMAGE;
	// Line2 takes its resolution from the renderer's viewport, in CSS pixels.
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);
	const scene = new three.Scene();
	lightScene(three, scene);

	for (const { size, position, color } of LINE_BOXES) {
		const box = new three.Mesh(
			new three.BoxGeometry(...size),
			new three.MeshStandardMaterial({ color }),
		);
		box.position.set(...position);
		scene.add(box);
	}
	for (const line of basic ? BASIC_LINES : WIDE_LINES)
		scene.add(basic ? basicLine(three, line) : await wideLine(three, rendererName, line));

	const { fov, near, far, position, target } = LINE_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: basic ? 'lines-basic' : 'lines',
		renderer: rendererName,
		n: basic ? BASIC_LINE_COUNT : WIDE_LINE_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
