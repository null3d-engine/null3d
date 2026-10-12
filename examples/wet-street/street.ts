// The wet street's scenery: buildings of many widths and heights along both walks, with framed
// windows, dark or lit, and shop fronts with neon name boards, doors, awnings and neon blades.
// Street lamps light the road from the curbs, chrome bollards stand between them, and a yellow
// taxi with a lit roof sign waits in its lane. The still parts join one mesh per material, so the
// whole street draws in a few calls.
import { type Material, math, type SketchContext } from '@null3d/engine';
import { extrude, Shape } from '@null3d/geometry';

/** The street's ends along z, the half width of the road, and the width of each walk. */
export const NEAR = 40;
export const FAR = -70;
export const ROAD = 4.5;
const WALK = 4;
/** The building fronts' distance from the middle of the street. */
const FRONT = ROAD + WALK;
/** The height of the shop floor and of each floor over it, and the depth of a building. */
const SHOP = 4.2;
const FLOOR = 3.2;
const DEPTH = 10;
/** The neon colors of the signs, and the shops' names. */
const NEON = ['#ff2d8a', '#29e0ff', '#ffb02e', '#8c5bff', '#4dff88'];
const SHOPS = [
	'NOODLES',
	'BAR',
	'HOTEL',
	'RAMEN',
	'DINER',
	'CAFE',
	'LAUNDRY',
	'BOOKS',
	'PIZZA',
	'KARAOKE',
	'JAZZ CLUB',
	'PHARMACY',
	'SUSHI',
	'OPEN 24H',
	'TATTOO',
	'RECORDS',
];
/** The sign atlas's side, and the height of one sign in it, in texels. */
const ATLAS = 1024;
const ROW = 48;
/** The shop interiors' canvas: its width, and the height of each kind of shop in it, in texels. */
const ROOM_WIDTH = 1024;
const ROOM = 128;
/** The kinds of shop interior: shelves of goods, a counter under lamps, and clothes on racks. */
const KINDS = 3;
/** The taxi's lane across the road. */
export const LANE = -2.2;

/** A mesh's arrays as they grow: positions, normals, texture coordinates and triangles. */
interface Arrays {
	positions: number[];
	normals: number[];
	uvs: number[];
	indices: number[];
}
type Triple = readonly number[];
const empty = (): Arrays => ({ positions: [], normals: [], uvs: [], indices: [] });

const cross = (a: Triple, b: Triple) => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];

/** Adds a rectangle from a corner along two edges. It faces along the edges' cross product. */
function quad(into: Arrays, corner: Triple, right: Triple, up: Triple, uv: Triple = [0, 0, 1, 1]) {
	const base = into.positions.length / 3;
	const normal = cross(right, up);
	const length = Math.hypot(normal[0], normal[1], normal[2]);
	for (const [s, t] of [
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1],
	]) {
		for (let i = 0; i < 3; i++) {
			into.positions.push(corner[i] + right[i] * s + up[i] * t);
			into.normals.push(normal[i] / length);
		}
		into.uvs.push(math.lerp(uv[0], uv[2], s), math.lerp(uv[1], uv[3], t));
	}
	into.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Adds a box from its center and its size along each axis, with flat faces. */
function box(into: Arrays, center: Triple, size: Triple) {
	for (let axis = 0; axis < 3; axis++)
		for (const sign of [-1, 1]) {
			const normal = [0, 0, 0];
			normal[axis] = sign;
			const up = axis === 1 ? [0, 0, 1] : [0, 1, 0];
			const right = cross(up, normal).map((v, i) => v * size[i]);
			const height = up.map((v, i) => v * size[i]);
			const corner = center.map((v, i) => v + (normal[i] * size[i] - right[i] - height[i]) / 2);
			quad(into, corner, right, height);
		}
}

/**
 * Builds the buildings, the shop signs, the street lamps, the bollards and the taxi. Returns the
 * taxi's group and the light of its headlights, for the sketch to move.
 */
export async function street(ctx: SketchContext) {
	const { scene, geometry, materials, textures } = ctx;
	const length = NEAR - FAR;
	const middle = (NEAR + FAR) / 2;
	const plain = (color: string, roughness: number, metalness = 0) =>
		materials.standard({ color, roughness, metalness });
	const glow = (color: string, strength: number) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity: strength });
	const walls = ['#5a3328', '#4a4a4e', '#2f4646', '#6a5a46', '#43354a'].map((c) => plain(c, 0.85));
	const trim = plain('#8a8478', 0.6);
	const shopTrim = plain('#1c1d21', 0.35, 0.6);
	const board = plain('#0d0e10', 0.5);
	const curb = plain('#3a3d42', 0.3);
	const paint = plain('#8a8a80', 0.5);
	const pole = plain('#2b2f36', 0.4, 1);
	const tank = plain('#3a2c22', 0.8);
	const chrome = plain('#f0f0f0', 0.12, 1);
	const awnings = ['#7a1f24', '#1f4a3a', '#26386a'].map((c) => plain(c, 0.7));
	// Window panes: dark glass that mirrors the street, or a room lit warm, cool, by a TV, or
	// through a curtain.
	const dark = plain('#06080c', 0.05);
	const rooms = [
		glow('#ffc47a', 2.4),
		glow('#a8c8ff', 1.8),
		glow('#5a7dff', 1.4),
		glow('#ff9a4a', 0.8),
	];
	const pane = () => {
		const r = math.random();
		return r < 0.22
			? rooms[0]
			: r < 0.3
				? rooms[1]
				: r < 0.33
					? rooms[2]
					: r < 0.43
						? rooms[3]
						: dark;
	};
	// Shop windows and doors: dark glass that mirrors the street, with a dim room behind it.
	const shopGlass = { color: '#0b0e13', roughness: 0.05 } as const;
	const door = materials.standard({ ...shopGlass, emissive: '#ffb070', emissiveIntensity: 0.12 });
	const neon = NEON.map((color) => glow(color, 9));
	const lamp = glow('#ffd59a', 12);
	const barrel = geometry.cylinder({ radiusTop: 0.9, radiusBottom: 0.9, height: 1.6 });
	const pick = <T>(list: readonly T[]) => list[math.randInt(0, list.length - 1)];

	// Every still part of the street joins one mesh per material, so the street draws in a few calls.
	const street = new Map<Material, Arrays>();
	const into = (parts: Map<Material, Arrays>, material: Material) => {
		const arrays = parts.get(material) ?? empty();
		parts.set(material, arrays);
		return arrays;
	};
	const signs = empty();
	const windows = empty();

	// The shop signs' names, drawn in neon tubes on one canvas. Each sign keeps its place on it.
	const atlas = new OffscreenCanvas(ATLAS, ATLAS);
	const pen = atlas.getContext('2d') as OffscreenCanvasRenderingContext2D;
	pen.fillStyle = '#000000';
	pen.fillRect(0, 0, ATLAS, ATLAS);
	pen.textAlign = 'center';
	pen.textBaseline = 'middle';
	const shelf = [0, 0];
	const lettering = (text: string, color: string, aspect: number) => {
		const width = Math.round(ROW * aspect);
		if (shelf[0] + width > ATLAS) shelf.splice(0, 2, 0, shelf[1] + ROW);
		const [x, y] = shelf;
		shelf[0] += width + 2;
		pen.font = `bold ${ROW * 0.6}px sans-serif`;
		const size = ROW * 0.6 * Math.min(1, (width * 0.8) / pen.measureText(text).width);
		pen.font = `bold ${size}px sans-serif`;
		pen.shadowColor = color;
		pen.shadowBlur = ROW * 0.2;
		pen.fillStyle = color;
		pen.fillText(text, x + width / 2, y + ROW / 2);
		pen.strokeStyle = color;
		pen.lineWidth = 2;
		pen.strokeRect(x + 3, y + 3, width - 6, ROW - 6);
		pen.shadowBlur = 0;
		pen.fillStyle = 'rgba(255, 255, 255, 0.55)';
		pen.fillText(text, x + width / 2, y + ROW / 2);
		return [x / ATLAS, 1 - (y + ROW) / ATLAS, (x + width) / ATLAS, 1 - y / ATLAS];
	};

	// The rooms behind the shop windows, dim and seen through dark glass, one row of the canvas for
	// each kind of shop. A window shows a stretch of its kind's row as wide as the window.
	const interiors = new OffscreenCanvas(ROOM_WIDTH, ROOM * KINDS);
	const brush = interiors.getContext('2d') as OffscreenCanvasRenderingContext2D;
	let state = 7;
	// The rooms take their own sequence, so the street keeps the layout of the seeded generator.
	const hash = () => {
		state = (state * 16807) % 2147483647;
		return state / 2147483647;
	};
	const tones = ['#5a4636', '#38485a', '#5a3848', '#4a5a3a', '#6a5a3a'];
	for (let kind = 0; kind < KINDS; kind++) {
		const top = kind * ROOM;
		const wall = brush.createLinearGradient(0, top, 0, top + ROOM);
		wall.addColorStop(0, ['#4a3a2a', '#2c3440', '#40303a'][kind] as string);
		wall.addColorStop(1, '#0c0a08');
		brush.fillStyle = wall;
		brush.fillRect(0, top, ROOM_WIDTH, ROOM);
		for (let x = 0; x < ROOM_WIDTH; ) {
			const step = 40 + hash() * 50;
			if (kind === 0) {
				// Shelves of goods along the back wall.
				for (const shelf of [0.3, 0.52, 0.74]) {
					brush.fillStyle = '#16120e';
					brush.fillRect(x, top + ROOM * shelf, step - 4, 3);
					for (let g = x + 2; g < x + step - 10; g += 6 + hash() * 6) {
						const h = ROOM * (0.06 + hash() * 0.1);
						brush.fillStyle = tones[Math.floor(hash() * tones.length)] as string;
						brush.fillRect(g, top + ROOM * shelf - h, 4 + hash() * 4, h);
					}
				}
			} else if (kind === 1) {
				// A counter, stools and lamps that hang from the ceiling.
				brush.fillStyle = '#120e0c';
				brush.fillRect(x, top + ROOM * 0.66, step, ROOM * 0.34);
				brush.fillRect(x + step * 0.3, top + ROOM * 0.8, 6, ROOM * 0.2);
				const lamp = brush.createRadialGradient(
					x + step / 2,
					top + 22,
					1,
					x + step / 2,
					top + 22,
					26,
				);
				lamp.addColorStop(0, '#ffd8a0');
				lamp.addColorStop(0.15, '#a07040');
				lamp.addColorStop(1, 'rgba(0, 0, 0, 0)');
				brush.fillStyle = lamp;
				brush.fillRect(x + step / 2 - 26, top, 52, 52);
			} else {
				// Clothes on a rail, and a lit plinth with a piece on show.
				brush.fillStyle = '#1a1612';
				brush.fillRect(x, top + ROOM * 0.25, step - 6, 2);
				for (let g = x + 3; g < x + step - 10; g += 5 + hash() * 4) {
					brush.fillStyle = tones[Math.floor(hash() * tones.length)] as string;
					brush.fillRect(g, top + ROOM * 0.26, 4, ROOM * (0.25 + hash() * 0.15));
				}
				brush.fillStyle = '#6a6058';
				brush.fillRect(x + step / 2 - 8, top + ROOM * 0.72, 16, ROOM * 0.28);
			}
			x += step;
		}
	}
	const room = (kind: number, from: number, aspect: number) => {
		const span = (ROOM * aspect) / ROOM_WIDTH;
		const start = (Math.abs(from) * 0.137) % (1 - span);
		return [start, 1 - (kind + 1) / KINDS, start + span, 1 - kind / KINDS];
	};

	// A building: walls, stone trim, framed windows on each floor and a shop front at the street.
	// Distances along the front run from the building's left edge as seen from the street.
	const building = (side: number, left: number, width: number, floors: number) => {
		const out = -side;
		const face = side * FRONT;
		const top = SHOP + floors * FLOOR;
		const along = (s: number) => left + side * s;
		const centre = along(width / 2);
		// A box on the front, from `from` to `to` meters out of the wall.
		const on = (
			material: Material,
			s: number,
			y: number,
			w: number,
			h: number,
			from: number,
			to: number,
		) =>
			box(
				into(street, material),
				[face + (out * (from + to)) / 2, y + h / 2, along(s)],
				[to - from, h, w],
			);
		// A pane facing the street, `at` meters out of the wall.
		const glass = (
			to: Arrays,
			s: number,
			y: number,
			w: number,
			h: number,
			at: number,
			uv?: Triple,
		) => quad(to, [face + out * at, y, along(s - w / 2)], [0, 0, side * w], [0, h, 0], uv);

		box(
			into(street, pick(walls)),
			[face + (side * DEPTH) / 2, top / 2, centre],
			[DEPTH, top, width],
		);
		for (const s of [0.2, width - 0.2]) on(trim, s, 0, 0.4, top, 0, 0.1);
		on(trim, width / 2, top - 0.1, width + 0.2, 0.5, 0, 0.35);
		for (let f = 0; f < floors; f++)
			on(trim, width / 2, SHOP + f * FLOOR - 0.1, width, 0.12, 0, 0.05);
		const bays = Math.max(2, Math.round(width / 2.4));
		const bay = width / bays;
		const w = Math.min(1.3, bay * 0.55);
		const h = 1.75;
		for (let f = 0; f < floors; f++)
			for (let b = 0; b < bays; b++) {
				const s = (b + 0.5) * bay;
				const y = SHOP + f * FLOOR + 0.85;
				on(trim, s, y - 0.08, w + 0.16, h + 0.16, 0, 0.06);
				glass(into(street, pane()), s, y, w, h, 0.065);
				on(trim, s, y, 0.05, h, 0.065, 0.1);
				on(trim, s, y + h * 0.68, w, 0.05, 0.065, 0.1);
				on(trim, s, y - 0.22, w + 0.36, 0.1, 0, 0.18);
			}

		// The shop front: a window of dark glass onto a dim room, with mullions and a transom over a
		// kick plate, a glazed door, and a board with the shop's name in neon. Some shops have an
		// awning, some a neon blade over the walk.
		const shown = width - 2.6;
		const shop = 0.6 + shown / 2;
		on(shopTrim, shop, 0, shown + 0.16, 3.06, 0, 0.06);
		const kind = math.randInt(0, KINDS - 1);
		glass(windows, shop, 0.55, shown, 2.4, 0.065, room(kind, left, shown / 2.4));
		on(shopTrim, shop, 0, shown, 0.55, 0.065, 0.12);
		on(shopTrim, shop, 2.35, shown, 0.07, 0.065, 0.1);
		const mullions = Math.floor(shown / 1.6);
		for (let m = 1; m <= mullions; m++)
			on(shopTrim, 0.6 + (m * shown) / (mullions + 1), 0.55, 0.07, 2.4, 0.065, 0.1);
		on(shopTrim, width - 1.2, 0, 1.26, 2.6, 0, 0.06);
		glass(into(street, door), width - 1.2, 0.1, 0.94, 2.36, 0.065);
		on(board, width / 2, 3.25, width - 0.8, 0.8, 0, 0.12);
		const tint = pick(NEON);
		const sign = Math.min(width - 1.4, 6);
		glass(signs, width / 2, 3.33, sign, 0.64, 0.13, lettering(pick(SHOPS), tint, sign / 0.64));
		if (math.random() < 0.4) {
			const cloth = pick(awnings);
			on(cloth, shop, 3.0, shown + 0.4, 0.1, 0, 1.3);
			on(cloth, shop, 2.7, shown + 0.4, 0.35, 1.22, 1.3);
		}
		if (math.random() < 0.35) on(pick(neon), 0.5, SHOP + 0.4, 0.12, 2.4, 0.25, 1.1);
		// A water tank on some roofs.
		if (floors > 1 && math.random() < 0.45) {
			const at: [number, number, number] = [
				face + side * math.randFloat(3, 7),
				top + 1.4,
				along(math.randFloat(2, width - 2)),
			];
			scene.createMesh({ mesh: barrel, material: tank, position: at });
			box(into(street, pole), [at[0], top + 0.3, at[2]], [1.4, 0.6, 1.4]);
		}
	};

	for (const side of [-1, 1]) {
		box(into(street, curb), [side * (ROAD + WALK / 2), 0.08, middle], [WALK, 0.16, length]);
		// Buildings of different widths and heights stand side by side along the walk.
		for (let z = FAR; z < NEAR; ) {
			const width = math.randFloat(6, 11);
			building(side, side < 0 ? z + width : z, width, math.randInt(1, 6));
			z += width;
		}
	}
	for (let z = FAR; z < NEAR; z += 6) box(into(street, paint), [0, 0.006, z], [0.14, 0.012, 2.6]);

	// Street lamps at the curbs: a pole and an arm that hold a housing over the road, lit
	// underneath, and the light it throws. A chrome bollard stands between each two lamps.
	const standard = geometry.cylinder({ radiusTop: 0.07, radiusBottom: 0.1, height: 5.2 });
	const bollard = geometry.cylinder({ radiusTop: 0.15, radiusBottom: 0.18, height: 0.9 });
	for (const side of [-1, 1])
		for (let z = FAR + 4; z < NEAR; z += 9) {
			const curbX = side * (ROAD + 0.4);
			const head = curbX - side * 1.3;
			scene.createMesh({ mesh: standard, material: pole, position: [curbX, 2.6, z] });
			box(into(street, pole), [curbX - side * 0.65, 5.12, z], [1.4, 0.1, 0.1]);
			box(into(street, pole), [head, 5.02, z], [0.9, 0.16, 0.38]);
			box(into(street, lamp), [head, 4.925, z], [0.78, 0.03, 0.3]);
			scene.createPointLight({
				position: [head, 4.6, z],
				color: '#ffc98a',
				intensity: 30,
				range: 16,
			});
			scene.createMesh({ mesh: bollard, material: chrome, position: [curbX, 0.6, z - 4.5] });
		}

	const join = (parts: Map<Material, Arrays>, options = {}) => {
		for (const [material, arrays] of parts)
			scene.createMesh({ mesh: geometry.fromArrays(arrays), material, ...options });
	};
	join(street);
	scene.createMesh({
		mesh: geometry.fromArrays(windows),
		material: materials.standard({
			...shopGlass,
			emissive: '#ffffff',
			emissiveIntensity: 1.2,
			emissiveMap: textures.fromImageBitmap(
				await createImageBitmap(interiors, { imageOrientation: 'flipY' }),
				{ anisotropy: 8 },
			),
		}),
	});
	scene.createMesh({
		mesh: geometry.fromArrays(signs),
		material: materials.standard({
			color: '#000000',
			emissive: '#ffffff',
			emissiveIntensity: 4,
			emissiveMap: textures.fromImageBitmap(
				await createImageBitmap(atlas, { imageOrientation: 'flipY' }),
				{ anisotropy: 8 },
			),
		}),
	});

	// A yellow taxi with a lit roof sign, which drives up the street toward the camera. Its parts
	// join one mesh per material under one group, and its headlights light the road ahead.
	const label = new OffscreenCanvas(128, 48);
	const ink = label.getContext('2d') as OffscreenCanvasRenderingContext2D;
	ink.fillStyle = '#ffe9a0';
	ink.fillRect(0, 0, 128, 48);
	ink.fillStyle = '#141414';
	ink.font = 'bold 34px sans-serif';
	ink.textAlign = 'center';
	ink.textBaseline = 'middle';
	ink.fillText('TAXI', 64, 26);
	const roofSign = materials.standard({
		color: '#000000',
		emissive: '#ffffff',
		emissiveIntensity: 3,
		emissiveMap: textures.fromImageBitmap(
			await createImageBitmap(label, { imageOrientation: 'flipY' }),
		),
	});
	const taxi = scene.createGroup({ position: [LANE, 0, 0], dynamic: true });
	const car = new Map<Material, Arrays>();
	const yellow = materials.standard({ color: '#f2b200', roughness: 0.25 });
	const glazing = plain('#05070a', 0.05);
	const black = plain('#0a0a0b', 0.6);
	const bumper = plain('#2a2c30', 0.3, 0.8);
	const headlight = glow('#fff4e0', 20);
	const taillight = glow('#ff2020', 6);
	// Rounded parts come from side outlines, front toward -x, extruded across the car with beveled
	// edges, and turned so that the outline's front faces the way the taxi drives.
	const across = (outline: Shape, material: Material, width: number, bevel: number) =>
		scene
			.createMesh({
				mesh: geometry.fromArrays(
					extrude({
						shapes: outline,
						depth: width - 2 * bevel,
						bevelThickness: bevel,
						bevelSize: bevel,
						curveSegments: 16,
					}),
				),
				material,
				parent: taxi,
				position: [bevel - width / 2, 0, 0],
				dynamic: true,
			})
			.setRotationEuler(0, Math.PI / 2, 0);
	// The body, with round arches over the wheels, and the cabin's glass under a yellow roof.
	across(
		new Shape()
			.moveTo(-2.18, 0.36)
			.absarc(-1.45, 0.38, 0.46, Math.PI, 0, true)
			.absarc(1.45, 0.38, 0.46, Math.PI, 0, true)
			.lineTo(2.18, 0.36)
			.quadraticCurveTo(2.24, 0.36, 2.24, 0.44)
			.lineTo(2.24, 0.78)
			.quadraticCurveTo(2.24, 0.88, 2.1, 0.88)
			.lineTo(-1.95, 0.88)
			.quadraticCurveTo(-2.24, 0.86, -2.24, 0.74)
			.lineTo(-2.24, 0.44)
			.quadraticCurveTo(-2.24, 0.36, -2.18, 0.36),
		yellow,
		1.8,
		0.06,
	);
	across(
		new Shape().moveTo(-0.9, 0.9).lineTo(-0.4, 1.34).lineTo(1.0, 1.34).lineTo(1.35, 0.9),
		glazing,
		1.56,
		0.04,
	);
	across(
		new Shape()
			.moveTo(-0.42, 1.34)
			.lineTo(1.02, 1.34)
			.quadraticCurveTo(1.06, 1.34, 1.06, 1.37)
			.quadraticCurveTo(1.06, 1.4, 1.02, 1.4)
			.lineTo(-0.42, 1.4)
			.quadraticCurveTo(-0.46, 1.4, -0.46, 1.37)
			.quadraticCurveTo(-0.46, 1.34, -0.42, 1.34),
		yellow,
		1.62,
		0.03,
	);
	// Dark wheel wells, a black stripe along the sides, bumpers, a grille and the lights.
	for (const z of [-1.45, 1.45]) box(into(car, black), [0, 0.6, z], [1.5, 0.5, 0.96]);
	box(into(car, black), [0, 0.7, 0], [1.82, 0.05, 1.9]);
	for (const end of [-1, 1]) box(into(car, bumper), [0, 0.42, end * 2.32], [1.76, 0.14, 0.14]);
	box(into(car, bumper), [0, 0.6, 2.31], [0.7, 0.12, 0.04]);
	for (const x of [-0.6, 0.6]) {
		box(into(car, headlight), [x, 0.72, 2.3], [0.34, 0.13, 0.05]);
		box(into(car, taillight), [x * 1.08, 0.72, -2.3], [0.28, 0.11, 0.05]);
	}
	// The roof sign, with round ends.
	const signAt = [0, 1.57, -0.3] as const;
	box(into(car, roofSign), signAt, [0.56, 0.24, 0.26]);
	join(car, { parent: taxi, dynamic: true });
	const cap = geometry.cylinder({ radiusTop: 0.12, radiusBottom: 0.12, height: 0.26 });
	const signEnd = glow('#ffe9a0', 3);
	for (const x of [-0.28, 0.28])
		scene
			.createMesh({
				mesh: cap,
				material: signEnd,
				parent: taxi,
				position: [x, signAt[1], signAt[2]],
				dynamic: true,
			})
			.setRotationEuler(Math.PI / 2, 0, 0);
	const wheel = geometry.cylinder({ radiusTop: 0.4, radiusBottom: 0.4, height: 0.26 });
	const rubber = plain('#121212', 0.7);
	for (const x of [-0.8, 0.8])
		for (const z of [-1.45, 1.45])
			scene
				.createMesh({
					mesh: wheel,
					material: rubber,
					parent: taxi,
					position: [x, 0.4, z],
					dynamic: true,
				})
				.setRotationEuler(0, 0, Math.PI / 2);
	const beam = scene.createPointLight({
		position: [LANE, 0.9, 0],
		color: '#fff0d8',
		intensity: 40,
		range: 18,
	});
	return { taxi, beam };
}
