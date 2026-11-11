// The records texture of a species: one rgba16float data texture, 1024 texels wide, read with
// textureLoad only. Row 0 is the species header: the leaf's optics turned into the shader's terms,
// the textures' means, the quantisation box, the bark zones and the extras' colour. Row 1 holds the
// wind field's steady settings, which the page writes. Every later row holds wind records, 256 a
// row and four texels each, at their global ids, so one material serves every variant.
//
// Half floats keep 11 bits, so a value whose error would show is split in two: a high half and the
// remainder, which the shader adds back. The quantisation box and the wind records' parent ids are
// split so. The header is built in the kit stage, in a job worker, so this file holds no engine
// import.
import type { WindTable } from '../asset';
import type { SpeciesBox } from '../core/box';
import type { BarkZone, LeafOptics, Species } from '../core/record';
import { STAND_IN_BARK, type TextureManifest } from '../core/textures';
import { type Rgb, spreadMean } from '../core/types';
import { WIND_RECORD_FLOATS, windSway } from '../wind/records';

/**
 * Texels across the records texture.
 *
 * @category api/vegetation
 */
export const RECORDS_WIDTH = 1024;

/**
 * Rows of the records texture that the header takes before the wind records start.
 *
 * @category api/vegetation
 */
export const HEADER_ROWS = 2;

/** Wind records in one row of the records texture: four texels each. */
export const RECORDS_PER_ROW = RECORDS_WIDTH / 4;

/** The steps of a quantised position along each axis of the species box. */
export const POSITION_STEPS = 65535;

/** The most bark zones the header holds. */
export const MAX_BARK_ZONES = 4;

/** The most extras whose colours the header holds. */
export const MAX_EXTRAS = 4;

/** The largest whole number a half float keeps, the height a limit that names none takes. */
const HALF_MAX = 65504;

/**
 * The texels of the header row. The plant shader holds the same numbers as `HEADER_*` constants,
 * and a test keeps the two equal.
 */
export const HEADER = {
	/** Upper face: base colour scale (reflectance over the texture's mean over one less the share), roughness. */
	upper: 0,
	/** Lower face: the same. */
	lower: 1,
	/** Upper face: transmitted colour over the share, then the share. */
	upperThrough: 2,
	/** Lower face: the same. */
	lowerThrough: 3,
	/** Upper face's reflectance, then the sheen. */
	upperReflectance: 4,
	/** Lower face's reflectance, then the leaf's length in metres. */
	lowerReflectance: 5,
	/** Transmittance, then the vein mask's luminance. */
	transmittance: 6,
	/** The textures' upper mean, then the vein mask's contrast. */
	upperMean: 7,
	/** The textures' lower mean, then the leaf's coverage. */
	lowerMean: 8,
	/** Autumn reflectance, then whether the record gives autumn colours. */
	autumnReflectance: 9,
	/** Autumn transmittance. */
	autumnTransmittance: 10,
	/** The box's lowest corner, high halves. */
	boxMin: 11,
	/** The box's lowest corner, remainders. */
	boxMinRest: 12,
	/** The box's size in metres, high halves. */
	boxSpan: 13,
	/** The box's size in metres, remainders. */
	boxSpanRest: 14,
	/** Young bark: its mean, then the radius below which wood draws it. */
	young: 15,
	/** Young bark: its tile round and along in metres, the bark zones, the deepest furrow in metres. */
	youngTile: 16,
	/** Moss: its colour, then how much. */
	moss: 17,
	/** Moss: how far up in metres, how much more on the north side, the collar ridge, the scars per metre. */
	mossReach: 18,
	/**
	 * The first extra's colour, then its roughness; the next `MAX_EXTRAS - 1` texels hold the
	 * others' in record order.
	 */
	extras: 19,
	/** The shoots' buds: their colour, then 1 when the record gives one. */
	bud: 23,
	/** The first bark zone; each zone takes `BARK_ZONE_TEXELS` texels. */
	barkZones: 24,
	/** Lichen: its colour, then how much. */
	lichen: 40,
	/** Lichen: its lowest and highest height in metres. */
	lichenReach: 41,
	/**
	 * The whole plant's sway: metres at its top at the field's base speed, cycles a second, then
	 * the power its share of that motion rises with along a stem.
	 */
	sway: 42,
	/**
	 * The first extra's band colour, then the band's roughness, as `extras` holds its body's; the
	 * next `MAX_EXTRAS - 1` texels hold the others' in record order.
	 */
	extraBands: 43,
	/**
	 * The first extra's scale pattern: its scale rows, the cells round its turn, and its band's
	 * share of the profile's height at each end; the next `MAX_EXTRAS - 1` texels hold the others'
	 * in record order. Rows of zero leave the body plain.
	 */
	extraScales: 47,
	/**
	 * The first extra's stalk colour, and its band's roughness; the next `MAX_EXTRAS - 1` texels
	 * hold the others' in record order.
	 */
	extraStalks: 51,
	/** The least width in pixels that a card's stalk draws, or 0 where the record gives none. */
	cardStalk: 55,
	/** Young bark: the tint its thin wood takes, where the record gives one. */
	youngTint: 56,
	/**
	 * The first bark zone's band on the other axis: its start, end, blend and whether the record
	 * gives one; the next `MAX_BARK_ZONES - 1` texels hold the other zones' in order.
	 */
	barkSeconds: 57,
	/** The autumn bark's linear tint, and 1 when the record gives one. */
	autumnBark: 61,
	/** The winter bark's linear tint, and 1 when the record gives one. */
	winterBark: 62,
	/** The winter leaves' linear reflectance, and 1 when the record gives them. */
	winterReflectance: 63,
	/** The winter leaves' linear transmittance. */
	winterTransmittance: 64,
	/** A tuft's basal sheath colour, then its roughness, where the record names one. */
	sheath: 65,
	/** A grass blade's collar: its colour, then the share of the blade's base it takes. */
	collar: 66,
} as const;

/**
 * Texels of one bark zone: its tint and layer; its start, end, blend and whether it runs by radius;
 * its tile round and along in metres and its height mapping; its layer's mean colour.
 */
export const BARK_ZONE_TEXELS = 4;

/** The header's texels that hold anything. */
export const HEADER_TEXELS = HEADER.collar + 1;

/** An extra's roughness where its record names none. */
export const EXTRA_ROUGHNESS = 0.6;

/** Faces round an extra's lathe at the nearest level where its record names none. */
const EXTRA_SIDES = 8;

/**
 * A number rounded to the nearest half float, ties to even, as the GPU's upload rounds it. The
 * exponent comes from exact doublings, so the result is the same on every device.
 */
export function toHalf(value: number): number {
	if (!Number.isFinite(value) || value === 0) return value;
	const size = Math.abs(value);
	if (size >= 65520) return Math.sign(value) * Infinity;
	let exponent = 0;
	let scale = 1;
	while (size >= scale * 2 && exponent < 15) {
		scale *= 2;
		exponent++;
	}
	while (size < scale && exponent > -14) {
		scale /= 2;
		exponent--;
	}
	const quantum = scale / 1024;
	const steps = size / quantum;
	let whole = Math.floor(steps);
	const rest = steps - whole;
	if (rest > 0.5 || (rest === 0.5 && whole % 2 === 1)) whole++;
	return Math.sign(value) * whole * quantum;
}

/** A value as two half floats whose sum keeps about 22 bits. */
function split(value: number): readonly [number, number] {
	const high = toHalf(value);
	return [high, value - high];
}

/**
 * The leaf optics that the species' foliage names, or none for a plant without leaves.
 *
 * @param record The species record.
 * @returns The optics.
 */
export function foliageOptics(record: Species): LeafOptics | undefined {
	const foliage = record.foliage;
	switch (foliage.kind) {
		case 'blade':
		case 'thick':
			return foliage.leaf.optics;
		case 'needle':
		case 'fascicle':
			return foliage.needle.optics;
		case 'grass-blade':
			return foliage.blade.optics;
		case 'scale-spray':
			return foliage.spray.optics;
		case 'frond':
			return foliage.optics;
		default:
			return undefined;
	}
}

const mean3 = (c: Rgb) => ((c[0] as number) + (c[1] as number) + (c[2] as number)) / 3;

/**
 * The share of a leaf's diffuse light that passes through it: its mean transmittance over its mean
 * reflectance and transmittance together. It stays below one so the base colour stays finite.
 *
 * @param reflectance The face's linear reflectance.
 * @param transmittance The leaf's linear transmittance.
 * @returns The share, from 0 to 0.9.
 */
export function transmissionShare(reflectance: Rgb, transmittance: Rgb): number {
	const r = mean3(reflectance);
	const t = mean3(transmittance);
	return r + t > 0 ? Math.min(t / (r + t), 0.9) : 0;
}

/**
 * One face's terms for the engine's light: the base colour's scale over the texel, the share of the
 * diffuse light that passes through, and the transmitted colour over that share. A front-lit face
 * then shows its reflectance, and a back-lit leaf its transmittance, whatever the share.
 *
 * @param reflectance The face's linear reflectance.
 * @param transmittance The leaf's linear transmittance.
 * @param mean The face's texture mean, which the texel is divided by.
 * @returns The scale of the texel, the share and the transmitted colour over the share.
 */
export function faceTerms(
	reflectance: Rgb,
	transmittance: Rgb,
	mean: Rgb,
): { readonly scale: Rgb; readonly share: number; readonly through: Rgb } {
	const share = transmissionShare(reflectance, transmittance);
	const keep = 1 - share;
	const scale = [0, 1, 2].map(
		(k) => (reflectance[k] as number) / Math.max(mean[k] as number, 1e-4) / keep,
	) as unknown as Rgb;
	const through = [0, 1, 2].map((k) =>
		share > 0 ? (transmittance[k] as number) / share : 0,
	) as unknown as Rgb;
	return { scale, share, through };
}

/** Writes one texel of four numbers. */
function texel(header: Float32Array, at: number, values: readonly number[]): void {
	header.set(values.slice(0, 4), at * 4);
}

/** A zone's start, end and blend in metres, by height or by radius. */
function zoneTexels(zone: BarkZone): readonly number[] {
	return [zone.from, zone.to, zone.blend, zone.by === 'radius' ? 1 : 0];
}

/**
 * The records texture's header rows of a species, four floats a texel. Row 1, the wind field's
 * steady settings, stays zero: the page writes it.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param box The species box.
 * @returns The header, `HEADER_ROWS` rows of `RECORDS_WIDTH` texels.
 */
export function speciesHeader(
	record: Species,
	manifest: TextureManifest,
	box: SpeciesBox,
): Float32Array {
	const header = new Float32Array(HEADER_ROWS * RECORDS_WIDTH * 4);
	const optics = foliageOptics(record);
	const leaf = manifest.leaf;
	if (optics) {
		// A species with no leaf texture samples a white texel, so its mean is white: the texel times
		// the scale then shows the record's own reflectance rather than a washed-out face.
		const upperMean = leaf?.mean.upper ?? ([1, 1, 1] as const);
		const lowerMean = leaf?.mean.lower ?? ([1, 1, 1] as const);
		const upper = faceTerms(optics.reflectance, optics.transmittance, upperMean);
		const lower = faceTerms(optics.reflectanceBack, optics.transmittance, lowerMean);
		texel(header, HEADER.upper, [...upper.scale, optics.roughness[0]]);
		texel(header, HEADER.lower, [...lower.scale, optics.roughness[1]]);
		texel(header, HEADER.upperThrough, [...upper.through, upper.share]);
		texel(header, HEADER.lowerThrough, [...lower.through, lower.share]);
		texel(header, HEADER.upperReflectance, [...optics.reflectance, optics.sheen ?? 0]);
		texel(header, HEADER.lowerReflectance, [...optics.reflectanceBack, leafLength(record)]);
		texel(header, HEADER.transmittance, [...optics.transmittance, leaf?.veins.luminance ?? 1]);
		texel(header, HEADER.upperMean, [...upperMean, leaf?.veins.contrast ?? 0]);
		texel(header, HEADER.lowerMean, [...lowerMean, leaf?.coverage ?? 0]);
		const autumn = record.seasons.autumn;
		texel(header, HEADER.autumnReflectance, [
			...(autumn?.reflectance ?? optics.reflectance),
			autumn ? 1 : 0,
		]);
		texel(header, HEADER.autumnTransmittance, [
			...(autumn?.transmittance ?? optics.transmittance),
			0,
		]);
	}
	const foliage = record.foliage;
	if (foliage.kind === 'grass-blade' && foliage.blade.collar)
		texel(header, HEADER.collar, [...foliage.blade.collar.colour, foliage.blade.collar.share]);
	const minParts = box.min.map(split);
	const spanParts = box.max.map((max, k) => split(max - (box.min[k] as number)));
	texel(header, HEADER.boxMin, [...minParts.map((p) => p[0]), 0]);
	texel(header, HEADER.boxMinRest, [...minParts.map((p) => p[1]), 0]);
	texel(header, HEADER.boxSpan, [...spanParts.map((p) => p[0]), 0]);
	texel(header, HEADER.boxSpanRest, [...spanParts.map((p) => p[1]), 0]);
	const bark = record.bark;
	const barkManifest = manifest.bark;
	if (bark) {
		const young = barkManifest?.young;
		texel(header, HEADER.young, [...(young?.mean ?? STAND_IN_BARK), bark.youngRadius]);
		texel(header, HEADER.youngTint, [...(bark.youngTint ?? [1, 1, 1]), 0]);
		const zones = bark.zones.slice(0, MAX_BARK_ZONES);
		texel(header, HEADER.youngTile, [
			young?.tile[0] ?? 0.12,
			young?.tile[1] ?? 0.12,
			zones.length,
			bark.displacement,
		]);
		const moss = bark.moss;
		texel(header, HEADER.moss, [...(moss?.colour ?? [0, 0, 0]), moss?.amount ?? 0]);
		texel(header, HEADER.mossReach, [
			moss?.up ?? 0,
			moss?.north ?? 0,
			bark.collar.ridge,
			bark.scars ?? 0,
		]);
		const lichen = bark.lichen;
		texel(header, HEADER.lichen, [...(lichen?.colour ?? [0, 0, 0]), lichen?.amount ?? 0]);
		texel(header, HEADER.lichenReach, [lichen?.from ?? 0, lichen?.to ?? HALF_MAX, 0, 0]);
		zones.forEach((zone, index) => {
			const layer = barkManifest?.layers[zone.layer];
			const at = HEADER.barkZones + index * BARK_ZONE_TEXELS;
			texel(header, at, [...(zone.tint ?? [1, 1, 1]), zone.layer]);
			texel(header, at + 1, zoneTexels(zone));
			texel(header, at + 2, [
				layer?.tile[0] ?? 0.5,
				layer?.tile[1] ?? 0.5,
				layer?.height.offset ?? 0,
				layer?.height.depth ?? 0,
			]);
			texel(header, at + 3, [...(layer?.mean ?? STAND_IN_BARK), 0]);
			const second = zone.second;
			texel(header, HEADER.barkSeconds + index, [
				second?.from ?? 0,
				second?.to ?? 0,
				second?.blend ?? 0,
				second ? 1 : 0,
			]);
		});
	}
	(record.extras ?? []).slice(0, MAX_EXTRAS).forEach((extra, index) => {
		const [body, band] = extra.roughness ?? [EXTRA_ROUGHNESS, EXTRA_ROUGHNESS];
		texel(header, HEADER.extras + index, [...extra.colour, body]);
		texel(header, HEADER.extraBands + index, [...(extra.bandColour ?? extra.colour), band]);
		const lathe = 'lathe' in extra.shape ? extra.shape : undefined;
		const rows = lathe?.scales ?? 0;
		const profile = lathe?.lathe ?? [];
		const height = profile.at(-1)?.[1] ?? 1;
		const around = rows > 0 ? (lathe?.sides ?? EXTRA_SIDES) : 0;
		const from = rows > 0 ? (lathe?.scaled?.[0] ?? 0) : 0;
		const to = rows > 0 ? Math.min(height, lathe?.scaled?.[1] ?? height) : 0;
		texel(header, HEADER.extraScales + index, [rows, around, from / height, to / height]);
		texel(header, HEADER.extraStalks + index, [
			...(extra.stalkColour ?? extra.bandColour ?? extra.colour),
			band,
		]);
	});
	const bud = record.shoots?.bud.colour;
	if (bud) texel(header, HEADER.bud, [...bud, 1]);
	const sway = windSway(record);
	texel(header, HEADER.sway, [sway.amplitude, sway.frequency, sway.power, 0]);
	const seasonBark = record.seasons.bark;
	if (seasonBark?.autumn) texel(header, HEADER.autumnBark, [...seasonBark.autumn, 1]);
	if (seasonBark?.winter) texel(header, HEADER.winterBark, [...seasonBark.winter, 1]);
	const winterLeaves = record.seasons.leaves?.winter;
	if (winterLeaves) {
		texel(header, HEADER.winterReflectance, [...winterLeaves.reflectance, 1]);
		texel(header, HEADER.winterTransmittance, [...winterLeaves.transmittance, 0]);
	}
	texel(header, HEADER.cardStalk, [record.lod.cardStalk ?? 0, 0, 0, 0]);
	return header;
}

/** The species' mean leaf length in metres, or zero for foliage that names none. */
function leafLength(record: Species): number {
	const foliage = record.foliage;
	const length =
		foliage.kind === 'blade'
			? foliage.leaf.length
			: foliage.kind === 'needle' || foliage.kind === 'fascicle'
				? foliage.needle.length
				: undefined;
	return length === undefined ? 0 : spreadMean(length);
}

/**
 * Rows of a species' records texture: the header, then every variant's wind records at their
 * global ids.
 *
 * @param variants The variants the species may grow.
 * @param perVariant Records each variant may hold.
 * @returns The rows.
 */
export function recordsRows(variants: number, perVariant: number): number {
	return HEADER_ROWS + Math.max(1, Math.ceil((variants * perVariant) / RECORDS_PER_ROW));
}

/**
 * Writes the wind field's steady settings into row 1 of a records texture's data: the air, the
 * gust, the swirl and a gust that a page sent, four numbers each.
 *
 * @param data The records texture's data.
 * @param air The four vectors.
 */
export function writeSteadyWind(
	data: Float32Array,
	air: {
		readonly base: readonly number[];
		readonly gust: readonly number[];
		readonly swirl: readonly number[];
		readonly sent: readonly number[];
	},
): void {
	const at = RECORDS_WIDTH * 4;
	data.set(air.base.slice(0, 4), at);
	data.set(air.gust.slice(0, 4), at + 4);
	data.set(air.swirl.slice(0, 4), at + 8);
	data.set(air.sent.slice(0, 4), at + 12);
}

/**
 * Writes a variant's wind records into a records texture's data, four texels a record at its global
 * id. A record is pivot and parent, axis and stiffness, flutter amplitude, frequency, order and
 * length, then sway phase, whip weight and spare. On the GPU the parent id, which a half float does
 * not keep past 2,048, goes as its high byte in the first texel's fourth number and its low byte in
 * the fourth texel's last number; -1 marks a record with no parent.
 *
 * @param data The records texture's data, `RECORDS_WIDTH` texels a row.
 * @param table The variant's wind table.
 * @returns Whether every record fitted the texture.
 */
export function writeWindRecords(data: Float32Array, table: WindTable): boolean {
	const rows = data.length / (RECORDS_WIDTH * 4);
	let fitted = true;
	for (let r = 0; r < table.count; r++) {
		const id = table.base + r;
		const row = HEADER_ROWS + Math.floor(id / RECORDS_PER_ROW);
		if (row >= rows) {
			fitted = false;
			continue;
		}
		const at = (row * RECORDS_WIDTH + (id % RECORDS_PER_ROW) * 4) * 4;
		const from = r * WIND_RECORD_FLOATS;
		const record = table.records.subarray(from, from + WIND_RECORD_FLOATS);
		data.set(record, at);
		const parent = record[3] as number;
		const whole = parent < 0 ? -1 : Math.round(parent);
		data[at + 3] = whole < 0 ? -1 : Math.floor(whole / 256);
		data[at + 15] = whole < 0 ? -1 : whole % 256;
	}
	return fitted;
}

/**
 * Writes one shoot row's four values as the plant shader reads them, each a whole number below
 * 2,048 or one plus a share in 64 steps, so a half float keeps it exactly: the parent wind record
 * over 32; its last five bits plus the flutter phase; the sky visibility times 8 plus the bent
 * normal's top three bits; the bent normal's low five bits times 16 plus the near slot. A WebGL2
 * device may keep a row's values at half precision.
 *
 * @param out The batch's values, four a row.
 * @param row The row.
 * @param record The parent axis's global wind record, below 65,536.
 * @param phase The row's flutter phase, from 0 to 255.
 * @param sky The row's sky visibility, from 0 to 250.
 * @param bent The row's bent normal code, from 0 to 255.
 * @param slot The copy's near slot, from 0 to 15.
 */
export function writeShootRow(
	out: Float32Array,
	row: number,
	record: number,
	phase: number,
	sky: number,
	bent: number,
	slot: number,
): void {
	const at = row * 4;
	out[at] = record >>> 5;
	out[at + 1] = (record & 31) + (Math.min(phase, 255) >>> 2) / 64;
	out[at + 2] = sky * 8 + (bent >>> 5);
	out[at + 3] = (bent & 31) * 16 + slot;
}
