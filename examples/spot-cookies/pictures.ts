// The pictures that the spot-cookies demo projects: a rose window of stained glass with lead
// between its panes, and a lit window frame with its bars. Each comes as sRGB pixels for a spot
// light's `map`, made in code from a seeded hash, so each run makes the same picture.

/** A picture of `size` pixels a side, as sRGB bytes. */
export interface Picture {
	width: number;
	height: number;
	data: Uint8Array;
}

/** A value from 0 to 1 for a whole number and a seed. */
function hash(x: number, y: number, seed: number): number {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The glass colors, as sRGB: gold, ruby, emerald, sapphire, amethyst and pale blue. */
const GLASS: readonly (readonly [number, number, number])[] = [
	[255, 196, 84],
	[214, 46, 52],
	[38, 156, 96],
	[40, 88, 200],
	[142, 58, 168],
	[120, 190, 235],
];

/**
 * A rose window of `size` pixels a side: rings of glass panes, each cut into a ring's count of
 * sectors, with dark lead between them and a bright glow in each pane's middle. The picture's
 * middle is the window's middle, so the pane of the light shows the circle whole.
 */
export function roseWindow(size = 512): Picture {
	const data = new Uint8Array(size * size * 4);
	// The radii of the lead between the rings, from the middle outward. Beyond the last one the
	// window ends in a dark rim, at the circle that the cone's edge shows.
	const rings = [0.08, 0.16, 0.26, 0.36, 0.46];
	const sectors = [8, 12, 16, 24, 32];
	const lead = 1.2 / size;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const at = (y * size + x) * 4;
			const px = (x + 0.5) / size - 0.5;
			const py = (y + 0.5) / size - 0.5;
			const radius = Math.hypot(px, py);
			const angle = Math.atan2(py, px) / (2 * Math.PI) + 0.5;
			let color: readonly [number, number, number] = [0, 0, 0];
			// The ring that the point falls in, and the pane of that ring.
			let ring = 0;
			while (ring < rings.length && radius >= (rings[ring] as number)) ring++;
			if (ring === rings.length) {
				// Past the last pane: the window's dark rim, where the cone ends.
				color = radius < 0.5 ? [10, 10, 14] : [0, 0, 0];
			} else {
				const inner = ring === 0 ? 0 : (rings[ring - 1] as number);
				const outer = rings[ring] as number;
				const count = sectors[ring] as number;
				const sector = Math.floor(angle * count);
				const middle = (sector + 0.5) / count;
				// The distance to the pane's lead: the rim of its ring, its sides, or the rim.
				const toRing = Math.min(radius - inner, outer - radius);
				const toSide = Math.abs(angle - middle) * 2 * Math.PI * radius;
				const toLead = Math.min(toRing, toSide);
				if (toLead < lead) {
					// Lead is nearly black, which the light shows as a dark line.
					color = [12, 12, 16];
				} else {
					const glass = GLASS[Math.floor(hash(ring, sector, 7) * GLASS.length)] as readonly [
						number,
						number,
						number,
					];
					// Each pane glows from its middle, and its glass has a little grain.
					const glow = 0.7 + 0.4 * Math.min(1, toLead / (0.035 + ring * 0.012));
					const grain = 0.92 + 0.2 * hash(x >> 2, y >> 2, ring * 31 + sector);
					color = [
						Math.min(255, (glass[0] as number) * glow * grain),
						Math.min(255, (glass[1] as number) * glow * grain),
						Math.min(255, (glass[2] as number) * glow * grain),
					];
				}
			}
			data[at] = color[0];
			data[at + 1] = color[1];
			data[at + 2] = color[2];
			data[at + 3] = 255;
		}
	}
	return { width: size, height: size, data };
}

/**
 * A lit window of `size` pixels a side: warm light through four panes, with dark bars between them
 * and a frame around the outside. The light falls off toward the window's edge, as a real window's
 * does, so the projection has a soft edge rather than a cut one.
 */
export function windowFrame(size = 128): Picture {
	const data = new Uint8Array(size * size * 4);
	const bar = 0.05;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const at = (y * size + x) * 4;
			const px = (x + 0.5) / size;
			const py = (y + 0.5) / size;
			const alongBar = Math.abs(px - 0.5) < bar / 2 || Math.abs(py - 0.5) < bar / 2;
			const alongFrame = px < bar || py < bar || px > 1 - bar || py > 1 - bar;
			const edge = Math.min(px, py, 1 - px, 1 - py);
			const glow = Math.min(1, edge / 0.18);
			const warm = [255, 214, 158] as const;
			const color = alongBar || alongFrame ? [18, 14, 10] : warm;
			const level = alongBar || alongFrame ? 1 : 0.7 + 0.3 * glow;
			data[at] = color[0] * level;
			data[at + 1] = color[1] * level;
			data[at + 2] = color[2] * level;
			data[at + 3] = 255;
		}
	}
	return { width: size, height: size, data };
}
