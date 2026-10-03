// The docs side of the quality presets: the planned rows of the preset table, whose features are
// not built yet, each setting's name in the table and how the table prints its values, and the
// names of the device kinds and GPU paths in the tables of how the engine chooses a preset.
// tools/gen-docs.ts writes those tables on the quality presets page from this file and the
// engine's constants. Runtime code never imports this file, so the engine's files carry none of it.

import type { Tier } from '../shared/tier';
import { type DeviceKind, TABLET_MIN_EDGE } from './chooser';
import { MIB, QUALITY_SETTINGS, type Setting, type SettingChange } from './presets';

/**
 * The settings of features that are not built yet, with their planned value on each preset. A
 * feature moves its row into the engine's table (presets.ts) when it applies the setting.
 */
export const PLANNED_SETTINGS = {
	maxLights: {
		presets: [256, 256, 512, 1024],
		changes: 'start',
		values: { min: 1, max: 4096, whole: true },
	},
	maxLightsPerCluster: {
		presets: [32, 64, 64, 128],
		changes: 'start',
		values: { min: 1, max: 256, whole: true },
	},
	// Low and Medium stay under half the GPU texture memory at which a tablet's tab died (D-12).
	textureMemoryMiB: {
		presets: [256, 512, 1024, 2048],
		changes: 'start',
		values: { min: 64, max: 16384, whole: true },
	},
} as const satisfies Record<string, Setting>;

/** Every row of the preset table: the settings that the engine applies, and the planned ones. */
const ALL_SETTINGS = { ...QUALITY_SETTINGS, ...PLANNED_SETTINGS };

/** The name of any setting in the preset table, applied or planned. */
export type AnySettingName = keyof typeof ALL_SETTINGS;

/** A setting's docs text. */
interface SettingDocs<T> {
	/** The setting's name in the preset table. */
	label: string;
	/** A value as the table prints it. Without it, the table prints the value as it is. */
	print?: (value: T) => string;
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no');
const ordinals: Record<number, string> = { 2: '2nd', 3: '3rd' };
/** An update interval in words: "every frame", "every 2nd frame". */
const everyNth = (frames: number) =>
	frames === 1 ? 'every frame' : `every ${ordinals[frames] ?? `${frames}th`} frame`;

/**
 * Each setting's name in the preset table, and how the table prints its values, in the order of
 * the table's rows.
 */
export const SETTING_DOCS: {
	[K in AnySettingName]: SettingDocs<(typeof ALL_SETTINGS)[K]['presets'][number]>;
} = {
	maxPixelRatio: {
		label: 'Pixel ratio cap',
		print: (value) => (value === Number.POSITIVE_INFINITY ? 'none' : String(value)),
	},
	minRenderScale: { label: 'Lowest render scale' },
	maxRenderScale: { label: 'Highest render scale' },
	antialias: {
		label: 'Anti-aliasing',
		print: (value) => ({ none: 'none', fxaa: 'FXAA', msaa: 'MSAA 4x' })[value],
	},
	shadowCascades: { label: 'Shadow cascades' },
	shadowMapSize: { label: 'Shadow map size in texels' },
	shadowFilter: { label: 'Shadow filter', print: (value) => `${value} x ${value} texels` },
	farCascadeInterval: { label: 'Far cascade updates', print: everyNth },
	shadowTiles: { label: 'Spot and point light shadow tiles' },
	shadowTileSize: { label: 'Shadow tile size in texels' },
	pointLightShadows: { label: 'Point light shadows', print: yesNo },
	governor: { label: 'Frame-budget governor', print: (value) => (value ? 'on' : 'off') },
	depthPrepass: { label: 'Depth prepass', print: yesNo },
	maxAnisotropy: { label: 'Anisotropic filtering cap', print: (value) => `${value}x` },
	uploadBytesPerFrame: {
		label: 'Texture uploads per frame',
		print: (value) => `${value / MIB} MiB`,
	},
	maxLights: { label: 'Point and spot lights per frame' },
	maxLightsPerCluster: { label: 'Lights per cluster' },
	textureMemoryMiB: { label: 'Texture memory budget', print: (value) => `${value} MiB` },
	memoryMaximumMiB: { label: 'Engine memory maximum', print: (value) => `${value} MiB` },
};

/** A row of the preset table as the docs print it. */
export interface SettingRow {
	name: AnySettingName;
	label: string;
	/** Each preset's value in words, from Low to Ultra. */
	values: string[];
	changes: SettingChange;
	/** True for a setting that the engine applies; false for a planned one. */
	built: boolean;
	setting: Setting;
}

/** Every row of the preset table, in the docs' order, with its values in words. */
export function settingRows(): SettingRow[] {
	return (Object.keys(SETTING_DOCS) as AnySettingName[]).map((name) => {
		const setting: Setting = ALL_SETTINGS[name];
		const docs = SETTING_DOCS[name] as SettingDocs<unknown>;
		const print = docs.print ?? String;
		return {
			name,
			label: docs.label,
			values: setting.presets.map((value) => print(value)),
			changes: setting.changes,
			built: name in QUALITY_SETTINGS,
			setting,
		};
	});
}

/** When a setting can change, as the preset table says it. */
export const CHANGE_DOCS: Record<SettingChange, string> = {
	live: 'during play',
	start: 'at the start',
	load: 'before loading',
};

/** Each kind of device and its signals, as the table of starting presets gives them. */
export const DEVICE_DOCS: Record<DeviceKind, { name: string; pointer: string; screen: string }> = {
	phone: { name: 'Phone', pointer: 'coarse', screen: `under ${TABLET_MIN_EDGE} CSS pixels` },
	tablet: { name: 'Tablet', pointer: 'coarse', screen: `${TABLET_MIN_EDGE} CSS pixels or more` },
	desktop: { name: 'Desktop or laptop', pointer: 'fine', screen: 'any' },
};

/** Each GPU path's name in the table of the highest presets. */
export const TIER_DOCS: Record<Tier, string> = {
	webgpu: 'WebGPU',
	'webgpu-compat': "WebGPU's compatibility mode",
	webgl2: 'WebGL2',
};
