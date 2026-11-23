// The messages between the sketch, the page and the audio thread's mixer. The module holds types
// alone, so every side imports it by type and none of them loads code from it.

/** How a voice turns a place into the sound in each ear. */
export type Panning = 'hrtf' | 'equal-power';

/** What kind of sound a description holds. */
export type SoundKind = 'loop' | 'group' | 'shot';

/** One sound, as the sketch made it: its file, its emitters in the table and its voices. */
export interface SoundSpec {
	/** The sound's number, unique for the sketch's life. */
	readonly id: number;
	readonly kind: SoundKind;
	/** The file's absolute address. */
	readonly file: string;
	/** The first emitter that the sound owns in the table. */
	readonly first: number;
	/** The emitters that the sound owns. */
	readonly count: number;
	/** The first voice that the sound owns. */
	readonly voice: number;
	/** The voices that the sound owns. */
	readonly voices: number;
	/** True when the sound comes from a place; false when it plays in both ears alike. */
	readonly positional: boolean;
	/** The distance at which the sound is at its full level, or 0 for no fall with distance. */
	readonly near: number;
	/** The distance at which the sound has faded out, or 0 for no such distance. */
	readonly far: number;
	/** True when the sound loses its highs with distance. */
	readonly muffle: boolean;
}

/** Where each block of values lies in the table, in float slots. */
export interface TableLayout {
	readonly capacity: number;
	readonly frame: number;
	readonly volume: number;
	readonly listenerAt: number;
	readonly listenerTurn: number;
	readonly places: number;
	readonly levels: number;
	readonly rates: number;
	readonly tones: number;
	readonly length: number;
}

/** What the sketch sends the page over the link that the page opened. */
export type SketchMessage =
	| {
			readonly type: 'table';
			readonly buffer: ArrayBuffer | SharedArrayBuffer;
			readonly layout: TableLayout;
			readonly panning: Panning;
	  }
	| { readonly type: 'add'; readonly sound: SoundSpec }
	| { readonly type: 'remove'; readonly id: number }
	| { readonly type: 'play'; readonly id: number; readonly slot: number }
	| { readonly type: 'panning'; readonly panning: Panning };

/** The order of the mixer's outputs, which the page and the mixer agree on as the mixer starts. */
export interface MixerOutputs {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly gain: number;
	readonly rate: number;
	readonly cutoff: number;
}

/** What the page gives the mixer as it makes it. */
export interface MixerSetup {
	readonly outputs: MixerOutputs;
	/** The voices that each output carries, one channel each. */
	readonly voices: number;
}

/** What the page sends the mixer. */
export type MixerMessage =
	| {
			readonly type: 'table';
			readonly layout: TableLayout;
			/** The shared table, or null when the page sends copies of it. */
			readonly buffer: SharedArrayBuffer | null;
	  }
	| { readonly type: 'copy'; readonly buffer: ArrayBuffer }
	| { readonly type: 'add'; readonly sound: SoundSpec }
	| { readonly type: 'remove'; readonly id: number }
	| { readonly type: 'ready'; readonly voice: number };

/** What the mixer sends the page. */
export type MixerReply =
	| { readonly type: 'idle' }
	| { readonly type: 'active' }
	| { readonly type: 'copy'; readonly buffer: ArrayBuffer };
