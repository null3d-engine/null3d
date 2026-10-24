// Facades: an interior-mapping material that draws a building's wall with a room behind every lit
// window, and the power-on wave that lights a scene window by window. The wall finishes and the
// window codes are made in code at the sketch's start, so the add-on ships no image file.
//
// A facade maps its windows from the world position, so one material draws every wall of an
// instanced batch and a window keeps its size whatever a building's scale. A window maps one cell
// across the mesh's own coordinates, for the windows that a scene already places on a wall.
//
// Both materials share the same surface function and the same atlases. The add-on reaches the
// engine only through the public entry points, so another project can copy it.
import type { ColorInput, Material, SketchContext } from '@null3d/engine';
import {
	ATLAS_SIZE,
	buildCodeAtlas,
	buildWallAtlas,
	CODE_SIZE,
	FACADE_KINDS,
	type FacadeKind,
	type GlassRect,
} from './atlases';
import shader from './facade.wgsl';

/** A facade's window pattern, in metres. A value that a look leaves out keeps its default. */
export interface FacadeWindow {
	/** The glass's width. The default is 1.7 m. */
	width?: number;
	/** The glass's height. The default is 1.5 m. */
	height?: number;
	/** The pier between two windows. The default is 1.1 m. */
	spacing?: number;
	/** The floor-to-floor height. The default is 3.4 m. */
	floorHeight?: number;
	/** The frame's band around the glass. The default is 0.13 m. */
	frame?: number;
	/**
	 * The height of the first floor's cell above the mesh's base, in metres. The default is 0.9 m.
	 * It places the window rows against a wall whose base stands on the ground.
	 */
	sill?: number;
}

/** The rooms behind the windows. A value that a look leaves out keeps its default. */
export interface FacadeRoom {
	/** How deep a room reaches behind its glass, in metres. The default is 2.2 m. */
	depth?: number;
	/** How strongly a lit room glows. The default is 2.4. */
	light?: number;
	/** How much a room's light flickers, from 0 for steady to 1 for candles and televisions. The default is 0.4. */
	flicker?: number;
	/** The share of a facade's windows that are lit. A window's own value overrides it. The default is 0.45. */
	litShare?: number;
	/** False leaves the furniture out of every room. The default draws it. */
	furniture?: boolean;
	/** False draws every room without blinds. The default draws them where a code asks. */
	blinds?: boolean;
}

/** The power-on wave: the moment and the point from which a scene's lights come on. */
export interface FacadeWave {
	/** The point on the ground that the wave starts from, as x and z. The default is the origin. */
	origin?: readonly [number, number];
	/** How fast the wave crosses the ground, in metres a second. The default is 2600. */
	speed?: number;
	/** The spring's rate in radians a second: how fast a light overshoots and settles. The default is 12. */
	rise?: number;
	/** The spring's damping: how quickly the overshoot dies away. The default is 6. */
	damping?: number;
	/**
	 * The time that the wave starts, in seconds of sketch time. It is already complete when a look
	 * leaves it out, so a scene starts lit unless it calls `start`.
	 */
	start?: number;
}

/** The look of a facade's walls, windows and rooms. A part that a look leaves out keeps its default. */
export interface FacadeLook {
	/** The wall finish, or `seed` to let each building's own value pick one. The default is `seed`. */
	kind?: FacadeKind | 'seed';
	/** The wall's tint, which multiplies the finish's own color. The default is white. */
	color?: ColorInput;
	/** The window pattern, in metres. */
	window?: FacadeWindow;
	/** The rooms behind the windows. */
	room?: FacadeRoom;
	/** The power-on wave, and the time that it starts. */
	power?: FacadeWave;
}

/** A facade material, and the controls that its scene drives. */
export interface Facade {
	/** The material to give to the walls. */
	readonly material: Material;
	/** Sets the share of the scene's own light that burns, from 0 by day to 1 by night. */
	setPower(share: number): void;
	/**
	 * Begins the power-on wave, at the sketch's time or at a given time. Each window's light rises
	 * when the wave reaches it and settles on a damped spring.
	 */
	start(at?: number): void;
}

/** The window pattern that a facade starts with. */
const DEFAULT_WINDOW: Required<FacadeWindow> = {
	width: 1.7,
	height: 1.5,
	spacing: 1.1,
	floorHeight: 3.4,
	frame: 0.13,
	sill: 0.9,
};

/** The rooms that a facade starts with. */
const DEFAULT_ROOM: Required<FacadeRoom> = {
	depth: 2.2,
	light: 2.4,
	flicker: 0.4,
	litShare: 0.45,
	furniture: true,
	blinds: true,
};

/** The power-on wave that a facade starts with, already complete. */
const DEFAULT_WAVE: Required<FacadeWave> = {
	origin: [0, 0],
	speed: 2600,
	rise: 12,
	damping: 6,
	start: -1e6,
};

/**
 * Makes a facade material: a wall of a chosen finish, with a window in each bay, and a room drawn
 * behind each lit window by interior mapping. The wall finishes and the rooms' codes are generated
 * in code and upload with the material, so a scene works offline and ships no image.
 */
export function createFacade(ctx: SketchContext, look: FacadeLook = {}): Facade {
	const window = { ...DEFAULT_WINDOW, ...look.window };
	// The cell holds the glass, a frame on each side and the pier between two windows.
	const cellWidth = window.width + 2 * window.frame + window.spacing;
	const left = (window.spacing / 2 + window.frame) / cellWidth;
	const below = 0.5 - window.height / (2 * window.floorHeight);
	const glass: GlassRect = { x0: left, y0: below, x1: 1 - left, y1: 1 - below };
	return build(ctx, look, window, cellWidth, window.floorHeight, glass, false);
}

/**
 * Makes a material for windows that a scene places itself: one cell across the mesh's own texture
 * coordinates, with the frame inside the mesh's edges. Give the mesh the glass's size plus the
 * frame on each side.
 */
export function createWindow(ctx: SketchContext, look: FacadeLook = {}): Facade {
	const window = { ...DEFAULT_WINDOW, ...look.window };
	const cellWidth = window.width + 2 * window.frame;
	const cellHeight = window.height + 2 * window.frame;
	const inside = { x: window.frame / cellWidth, y: window.frame / cellHeight };
	const glass: GlassRect = { x0: inside.x, y0: inside.y, x1: 1 - inside.x, y1: 1 - inside.y };
	return build(ctx, look, window, cellWidth, cellHeight, glass, true);
}

/**
 * Makes the material and its atlases, for one of the two mappings, and returns the controls that
 * drive its power.
 */
function build(
	{ textures, materials, time }: SketchContext,
	look: FacadeLook,
	window: Required<FacadeWindow>,
	cellWidth: number,
	floorHeight: number,
	glass: GlassRect,
	oneWindow: boolean,
): Facade {
	const room = { ...DEFAULT_ROOM, ...look.room };
	const wave = { ...DEFAULT_WAVE, ...look.power };
	const kind = look.kind ?? 'seed';
	const atlas = buildWallAtlas(glass);
	const codes = buildCodeAtlas();
	const wall = textures.fromData({
		width: atlas.size,
		height: atlas.size,
		data: atlas.color,
		colorSpace: 'srgb',
		mipmaps: true,
	});
	const surface = textures.fromData({
		width: atlas.size,
		height: atlas.size,
		data: atlas.orm,
		colorSpace: 'linear',
		mipmaps: true,
	});
	const code = textures.fromData({
		width: codes.size,
		height: codes.size,
		data: codes.data,
		colorSpace: 'linear',
		filter: 'nearest',
	});
	const material = materials.shader({
		wgsl: shader,
		textures: { wallMap: wall, wallOrm: surface, codeMap: code },
		uniforms: {
			power: 1,
			litShare: room.litShare,
			cellWidth,
			floorHeight,
			sill: oneWindow ? 0 : window.sill,
			glassX0: glass.x0,
			glassY0: glass.y0,
			glassX1: glass.x1,
			glassY1: glass.y1,
			windowWidth: window.width,
			windowHeight: window.height,
			roomDepth: room.depth,
			roomLight: room.light,
			flicker: room.flicker,
			waveStart: wave.start,
			waveSpeed: wave.speed,
			waveOriginX: wave.origin[0] ?? 0,
			waveOriginZ: wave.origin[1] ?? 0,
			waveRise: wave.rise,
			waveDamping: wave.damping,
			farFade: oneWindow ? 0.5 : 0.3,
			farFull: oneWindow ? 1.2 : 0.75,
			wallTile: kind === 'seed' ? -1 : FACADE_KINDS.indexOf(kind),
			shopHeight: 0,
			mode: oneWindow ? 1 : 0,
			furniture: room.furniture ? 1 : 0,
			blinds: room.blinds ? 1 : 0,
		},
		color: look.color ?? '#ffffff',
	});
	return {
		material,
		setPower(share) {
			material.setUniform('power', share);
		},
		start(at) {
			material.setUniform('waveStart', at ?? time.now);
		},
	};
}

/** The texels on each side of a wall atlas, for a caller that budgets its textures. */
export const WALL_ATLAS_SIZE = ATLAS_SIZE;

/** The texels on each side of the window code atlas, for a caller that budgets its textures. */
export const CODE_ATLAS_SIZE = CODE_SIZE;
