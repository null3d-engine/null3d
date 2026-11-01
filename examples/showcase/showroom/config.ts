// The car's configuration: the four choices that the tablet offers, the options of each, and the
// one rule that a tap applies. The module touches no engine, so a unit test can cycle every choice
// on its own.

/** One option of a configurable part, as the tablet names it. */
export interface ConfigOption {
	/** The name that the tablet shows, such as "Candy red". */
	readonly label: string;
	/** The value that the option gives its part, such as the paint's color as a hex string. */
	readonly value: string;
	/** The color of the option's swatch on the tablet. */
	readonly swatch: string;
	/** A short line of detail under the name, such as the paint's finish. */
	readonly detail: string;
}

/** The parts of the car that the configurator changes. */
export type ConfigPage = 'paint' | 'wheels' | 'trim' | 'lights';

/** A part's page on the tablet: its title and its options, in the order that a tap cycles them. */
export interface ConfigPageDef {
	readonly id: ConfigPage;
	readonly title: string;
	readonly options: readonly ConfigOption[];
}

/** The four pages, in the order of the tablet's tabs. */
export const PAGES: readonly ConfigPageDef[] = [
	{
		id: 'paint',
		title: 'Paint',
		options: [
			{
				label: 'Candy red',
				value: '#9e0b16',
				swatch: '#9e0b16',
				detail: 'Metal flake, clear coat',
			},
			{
				label: 'Midnight blue',
				value: '#14224e',
				swatch: '#14224e',
				detail: 'Fine flake, deep clear coat',
			},
			{
				label: 'Pearl white',
				value: '#d9d6cc',
				swatch: '#d9d6cc',
				detail: 'Soft flake, pearl clear coat',
			},
			{
				label: 'Racing green',
				value: '#0e3d2c',
				swatch: '#0e3d2c',
				detail: 'Coarse flake, clear coat',
			},
		],
	},
	{
		id: 'wheels',
		title: 'Wheels',
		options: [
			{ label: 'Silver', value: '#cfd3da', swatch: '#cfd3da', detail: '20 in, five spoke' },
			{ label: 'Graphite', value: '#4a4d54', swatch: '#4a4d54', detail: '20 in, five spoke' },
			{ label: 'Gold', value: '#b98a3e', swatch: '#b98a3e', detail: '20 in, five spoke' },
			{ label: 'Gloss black', value: '#17181c', swatch: '#17181c', detail: '20 in, five spoke' },
		],
	},
	{
		id: 'trim',
		title: 'Trim',
		options: [
			{ label: 'Carbon', value: 'carbon', swatch: '#2a2d33', detail: 'Twill 2x2, satin coat' },
			{
				label: 'Brushed steel',
				value: 'steel',
				swatch: '#9aa0a8',
				detail: 'Brushed, satin finish',
			},
			{ label: 'Gloss black', value: 'black', swatch: '#101114', detail: 'Gloss, clear coat' },
		],
	},
	{
		id: 'lights',
		title: 'Lights',
		options: [
			{ label: 'Ice white', value: '#eaf3ff', swatch: '#eaf3ff', detail: '6000 K, cool beam' },
			{ label: 'Warm', value: '#ffd6a0', swatch: '#ffd6a0', detail: '3000 K, warm beam' },
			{ label: 'Aqua', value: '#7fffe0', swatch: '#7fffe0', detail: 'Signature, aqua beam' },
			{ label: 'Violet', value: '#c79bff', swatch: '#c79bff', detail: 'Signature, violet beam' },
		],
	},
];

/** The car's configuration: the chosen option of each page. */
export interface Config {
	readonly paint: number;
	readonly wheels: number;
	readonly trim: number;
	readonly lights: number;
}

/** The configuration at the demo's start. */
export const START_CONFIG: Config = { paint: 0, wheels: 0, trim: 0, lights: 0 };

/** The configuration with the given page's choice moved on by a step, wrapping at the ends. */
export function cycle(config: Config, page: ConfigPage, step: number): Config {
	const options = PAGES.find((candidate) => candidate.id === page)?.options;
	if (!options) throw new Error(`there is no configurator page named ${page}`);
	const at = (config[page] + step) % options.length;
	return { ...config, [page]: at < 0 ? at + options.length : at };
}

/** The option that a page shows for a configuration. */
export function choice(config: Config, page: ConfigPage): ConfigOption {
	const options = PAGES.find((candidate) => candidate.id === page)?.options;
	const option = options?.[config[page]];
	if (!option)
		throw new Error(`there is no option ${config[page]} of the configurator page ${page}`);
	return option;
}

/** True for the name of a configurator page. */
export function isConfigPage(name: unknown): name is ConfigPage {
	return PAGES.some((page) => page.id === name);
}

/** The tablet's canvas, in texels. */
export const TABLET = { width: 512, height: 320 } as const;

/** A rectangle on the tablet's canvas, counted from its top left corner. */
export interface ScreenRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** The four page tabs along the bottom of the tablet. */
export const TABS: readonly (ScreenRect & { readonly page: ConfigPage })[] = PAGES.map(
	(page, index) => ({
		page: page.id,
		x: 10 + index * 125,
		y: 262,
		width: 119,
		height: 46,
	}),
);
/** The two arrows, and the value between them that a tap also cycles. */
export const PREV: ScreenRect = { x: 16, y: 146, width: 42, height: 50 };
export const NEXT: ScreenRect = { x: 454, y: 146, width: 42, height: 50 };
export const VALUE: ScreenRect = { x: 66, y: 146, width: 380, height: 50 };

/** True when a point on the canvas lies inside a rectangle. */
export function inside(point: { x: number; y: number }, rect: ScreenRect): boolean {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
}

/** What a tap does: show a page, or move the shown page's choice on by a step. */
export type TabletAction =
	| { readonly kind: 'page'; readonly page: ConfigPage }
	| { readonly kind: 'step'; readonly step: number };

/** What a tap on the tablet's canvas at a point does, or null for a tap that does nothing. */
export function tabletAction(point: { x: number; y: number }): TabletAction | null {
	const tab = TABS.find((candidate) => inside(point, candidate));
	if (tab) return { kind: 'page', page: tab.page };
	if (inside(point, PREV)) return { kind: 'step', step: -1 };
	if (inside(point, NEXT) || inside(point, VALUE)) return { kind: 'step', step: 1 };
	return null;
}
