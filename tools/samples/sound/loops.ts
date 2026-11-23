// Builds the sound loops and one-shots for the sample-assets repository, from the raw recordings that
// it keeps in `sources/sound/raw/`:
//
//   bun tools/samples/sound/loops.ts <output folder> [--raw <folder>] [--only <a,b>]
//     [--spectra <folder>]
//
// For each sound in the table below:
//
// 1. ffmpeg decodes its stretch of the recording, with a lead-in that lets the filters settle,
//    applies the sound's filters, resamples it to 48 kHz and gives 32-bit float samples, in mono
//    or stereo as the table says.
// 2. A loop takes one more crossfade's length than it keeps, and crossfades that tail into its
//    head with equal power, so its last sample runs on into its first. A one-shot's cut starts at
//    its first sound, and it fades out over its last moments.
// 3. A loop's gain brings its integrated loudness to its target. When the true peak would pass the
//    ceiling, a lookahead limiter holds it below. The loop goes through the limiter three times
//    over and keeps the middle copy, so the limiter's gain runs on across the seam too. A
//    one-shot's gain sets its true peak at the ceiling, with no limiter, so its crack stays whole.
// 4. libmp3lame encodes it as VBR MP3, into `<output>/<name>/<name>.mp3`, the folder of the
//    sound's asset in the sample-assets repository.
// 5. The check decodes the MP3 again and prints its loudness, true peak, length and size. For a
//    loop it prints the largest step between samples at the seam, where two copies meet, beside
//    the largest step inside the loop. It stops when a figure is out of bounds.
//
// The raw recordings come from the pinned sample content. `--raw <folder>` names another copy of
// the same files, such as the `sources/sound/raw` folder of a sample-assets checkout whose commit
// is not pinned yet. `--only` builds only the named sounds, and `--spectra <folder>` also writes a
// spectrum picture of each output there. FFMPEG names ffmpeg's executable, which defaults to the
// one on the path. It needs libmp3lame.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { samplePath } from '../../lib/samples.ts';

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
/** The sample rate of every output. */
export const RATE = 48_000;
/** The highest true peak an output may reach, in dBTP. */
export const PEAK_CEILING = -1;
/** How far below the ceiling a one-shot's true peak may land, in dB. */
const PEAK_TOLERANCE = 0.3;
/** How far the integrated loudness may miss its target, in LU. */
const LOUDNESS_TOLERANCE = 0.3;
/** The seconds that a decode starts before a cut, so the filters have settled when it begins. */
const LEAD_IN = 1;
/**
 * The level below which the sound add-on takes a sample at either end of a file for codec padding
 * and trims it. An output's ends stay well above it.
 */
export const PADDING_LEVEL = 1e-4;

/** One output: where it comes from in its recording, and how it is made. */
export interface Sound {
	/** The output's name, which names its file and its folder. */
	readonly name: string;
	/** The raw recording, as its path under the raw folder (`sources/sound/raw/`). */
	readonly raw: string;
	/** Where the cut starts in the recording, in seconds. */
	readonly start: number;
	/** The output's length in seconds. A loop's cut takes its crossfade's length on top. */
	readonly length: number;
	/** 1 for a point source, 2 for a bed. */
	readonly channels: 1 | 2;
	/** How a mono output comes from a stereo recording: one of its channels, or both mixed. */
	readonly mono?: 'left' | 'right' | 'mix';
	/** The ffmpeg audio filters that clean the recording, such as a high-pass, in the input's rate. */
	readonly filters?: readonly string[];
	/**
	 * The length in seconds of the crossfade that joins a loop's tail to its head, or the fade-out
	 * at a one-shot's end, which is not looped.
	 */
	readonly fade: number;
	/** Whether the output loops. */
	readonly loop: boolean;
	/**
	 * The integrated loudness that the output takes, in LUFS, with a limiter holding its true peak
	 * under the ceiling. Null sets the true peak at the ceiling instead, with no limiter, which keeps
	 * a one-shot's crack whole: its loudness is whatever that gives, and the demo sets its level.
	 */
	readonly loudness: number | null;
	/** libmp3lame's VBR quality, from 0 (largest) to 9 (smallest). */
	readonly quality: number;
}

/** The integrated loudness of every loop, so the demos can mix the beds and engines by gain. */
const BED = -20;

/** VBR qualities that give about 130 kbps in stereo and about 80 kbps in mono. */
const MONO_QUALITY = 4;
/** An engine's crossfade, short enough that its firing rhythm does not blur. */
const ENGINE_FADE = 0.4;

/** Every output, in the order the build makes them. */
export const SOUNDS: readonly Sound[] = [
	{
		// A designed hover engine's steady hum, made from a spinning hard drive, a vacuum cleaner
		// and a fridge.
		name: 'hover',
		raw: 'hover/peridactyloptrix-213384.ogg',
		start: 20,
		length: 6,
		channels: 1,
		mono: 'mix',
		filters: ['highpass=f=30:poles=2'],
		fade: ENGINE_FADE,
		loop: true,
		loudness: BED,
		quality: MONO_QUALITY,
	},
	{
		// A lighter hover hum for hover cars that pass at speed: a second take of the same designed
		// engine, with the low hum cut away so the whine and the vacuum cleaner's air remain.
		name: 'hover-pass',
		raw: 'hover-pass/peridactyloptrix-213528.ogg',
		start: 25,
		length: 3,
		channels: 1,
		mono: 'mix',
		filters: ['highpass=f=300:poles=2', 'highpass=f=300:poles=2'],
		fade: 0.3,
		loop: true,
		loudness: BED,
		quality: MONO_QUALITY,
	},
];

export interface Options {
	readonly out: string;
	readonly raw?: string;
	readonly only?: readonly string[];
	readonly spectra?: string;
}

/** The command line's options, checked against the sounds' names. */
export function parseArgs(args: readonly string[], sounds = SOUNDS): Options {
	const usage =
		'bun tools/samples/sound/loops.ts <output folder> [--raw <folder>] [--only <a,b>] [--spectra <folder>]';
	const out = args[0];
	if (!out || out.startsWith('--')) throw new Error(`Give the output folder: ${usage}`);
	const options: { out: string; raw?: string; only?: string[]; spectra?: string } = { out };
	for (let i = 1; i < args.length; i += 2) {
		const flag = args[i];
		const value = args[i + 1];
		if (value === undefined || value.startsWith('--'))
			throw new Error(`${flag} needs a value: ${usage}`);
		if (flag === '--raw') options.raw = value;
		else if (flag === '--spectra') options.spectra = value;
		else if (flag === '--only') {
			const names = value.split(',').filter((name) => name.length > 0);
			const unknown = names.filter((name) => !sounds.some((sound) => sound.name === name));
			if (names.length === 0 || unknown.length > 0)
				throw new Error(
					`--only takes a comma-separated list of ${sounds.map((s) => s.name).join(', ')}`,
				);
			options.only = names;
		} else throw new Error(`Unknown option ${flag}: ${usage}`);
	}
	return options;
}

/**
 * A loop from interleaved samples that run one fade longer than the loop: the tail past the loop's
 * length fades out over the head while the head fades in, with equal power. The last sample of the
 * result is the one before the tail, so the result runs on from its end into its start.
 */
export function crossfadeLoop(
	samples: Float32Array,
	channels: number,
	fadeFrames: number,
): Float32Array {
	const frames = samples.length / channels - fadeFrames;
	if (!Number.isInteger(frames) || frames <= fadeFrames)
		throw new Error('the cut must hold the loop and its crossfade, and the loop must be longer');
	const out = samples.slice(0, frames * channels);
	for (let i = 0; i < fadeFrames; i++) {
		const t = (i + 0.5) / fadeFrames;
		const into = Math.sin((t * Math.PI) / 2);
		const away = Math.cos((t * Math.PI) / 2);
		for (let c = 0; c < channels; c++) {
			const head = samples[i * channels + c] as number;
			const tail = samples[(frames + i) * channels + c] as number;
			out[i * channels + c] = head * into + tail * away;
		}
	}
	return out;
}

/** A one-shot's end faded out over `fadeFrames`, with a quarter sine. */
export function fadeOut(samples: Float32Array, channels: number, fadeFrames: number): Float32Array {
	const out = samples.slice();
	const frames = samples.length / channels;
	for (let i = 0; i < fadeFrames; i++) {
		const gain = Math.cos((((i + 1) / fadeFrames) * Math.PI) / 2);
		for (let c = 0; c < channels; c++) {
			const at = (frames - fadeFrames + i) * channels + c;
			out[at] = (out[at] as number) * gain;
		}
	}
	return out;
}

/**
 * The largest step between neighbouring samples where a loop's end meets its start, and the
 * largest step inside it, over every channel.
 */
export function seamSteps(
	samples: Float32Array,
	channels: number,
): { seam: number; inside: number } {
	const frames = samples.length / channels;
	let seam = 0;
	let inside = 0;
	for (let c = 0; c < channels; c++) {
		seam = Math.max(
			seam,
			Math.abs((samples[c] as number) - (samples[(frames - 1) * channels + c] as number)),
		);
		for (let i = 1; i < frames; i++) {
			const step = Math.abs(
				(samples[i * channels + c] as number) - (samples[(i - 1) * channels + c] as number),
			);
			if (step > inside) inside = step;
		}
	}
	return { seam, inside };
}

/**
 * The frames at each end that the sound add-on would take for codec padding: those before the first
 * and after the last sample at or above its level, on any channel.
 */
export function paddingFrames(
	samples: Float32Array,
	channels: number,
): { head: number; tail: number } {
	const frames = samples.length / channels;
	const loud = (frame: number) => {
		for (let c = 0; c < channels; c++)
			if (Math.abs(samples[frame * channels + c] as number) >= PADDING_LEVEL) return true;
		return false;
	};
	let head = 0;
	while (head < frames && !loud(head)) head++;
	let tail = 0;
	while (tail < frames - head && !loud(frames - 1 - tail)) tail++;
	return { head, tail };
}

/** ffmpeg's output and log for `args`, with `stdin` as its input. Throws when ffmpeg fails. */
function ffmpeg(
	args: readonly string[],
	stdin?: Uint8Array,
	loglevel = 'error',
): { stdout: Uint8Array; log: string } {
	const ran = Bun.spawnSync(
		[FFMPEG, '-hide_banner', '-nostdin', '-nostats', '-loglevel', loglevel, ...args],
		{ stdin: stdin ?? 'ignore', stdout: 'pipe', stderr: 'pipe' },
	);
	const log = ran.stderr.toString();
	if (ran.exitCode !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed:\n${log}`);
	return { stdout: ran.stdout, log };
}

const floats = (bytes: Uint8Array) =>
	new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
const bytesOf = (samples: Float32Array) =>
	new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
const rawInput = (channels: number) => [
	'-f',
	'f32le',
	'-ar',
	String(RATE),
	'-ac',
	String(channels),
];
/** ffmpeg's arguments that write 32-bit float samples to its output. */
const RAW_OUTPUT = ['-f', 'f32le', '-c:a', 'pcm_f32le', '-'];
/** The interleaved float samples that ffmpeg writes for `args`. */
const samplesOf = (args: readonly string[], stdin?: Uint8Array) =>
	floats(ffmpeg([...args, ...RAW_OUTPUT], stdin).stdout);

/** The ffmpeg filter that makes the output's channels from the recording's. */
function channelFilter(sound: Sound): string {
	if (sound.channels === 2) return 'pan=stereo|c0=c0|c1=c1';
	if (sound.mono === 'left') return 'pan=mono|c0=c0';
	if (sound.mono === 'right') return 'pan=mono|c0=c1';
	return 'pan=mono|c0=0.5*c0+0.5*c1';
}

/** The sound's cut of its recording, filtered, at the output's rate and channels. */
function decodeCut(sound: Sound, rawFolder: string): Float32Array {
	const extra = sound.loop ? sound.fade : 0;
	const lead = Math.min(LEAD_IN, sound.start);
	const filters = [
		channelFilter(sound),
		...(sound.filters ?? []),
		`aresample=${RATE}:filter_size=64`,
		`atrim=start=${lead}:duration=${sound.length + extra}`,
		'asetpts=PTS-STARTPTS',
	];
	const samples = samplesOf([
		'-ss',
		String(sound.start - lead),
		'-i',
		join(rawFolder, sound.raw),
		'-af',
		filters.join(','),
	]);
	const want = Math.round((sound.length + extra) * RATE) * sound.channels;
	if (samples.length < want)
		throw new Error(`${sound.name}: ${sound.raw} ends before the cut does`);
	return samples.subarray(0, want);
}

/** Integrated loudness in LUFS and true peak in dBTP, as ffmpeg's EBU R128 meter gives them. */
export function measure(
	samples: Float32Array,
	channels: number,
): { loudness: number; peak: number } {
	const { log } = ffmpeg(
		[...rawInput(channels), '-i', '-', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
		bytesOf(samples),
		'info',
	);
	const summary = log.slice(log.lastIndexOf('Summary:'));
	const loudness = Number(/I:\s*(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1]);
	const peak = Number(/Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1]);
	if (Number.isNaN(loudness) || Number.isNaN(peak))
		throw new Error(`ffmpeg's loudness meter gave no summary:\n${log}`);
	return { loudness, peak };
}

/**
 * The samples through a lookahead limiter whose ceiling is `ceiling` dBFS. A loop goes through as
 * three copies, and keeps the middle one, so the limiter's state runs on across its seam.
 */
function limit(samples: Float32Array, channels: number, ceiling: number, loop: boolean) {
	const copies = loop ? 3 : 1;
	const input = new Float32Array(samples.length * copies);
	for (let i = 0; i < copies; i++) input.set(samples, i * samples.length);
	const limited = samplesOf(
		[
			...rawInput(channels),
			'-i',
			'-',
			'-af',
			`alimiter=limit=${10 ** (ceiling / 20)}:attack=5:release=80:level=false:latency=true`,
		],
		bytesOf(input),
	);
	const at = loop ? samples.length : 0;
	return limited.slice(at, at + samples.length);
}

function scaled(samples: Float32Array, decibels: number): Float32Array {
	const gain = 10 ** (decibels / 20);
	return samples.map((value) => value * gain);
}

/**
 * The samples as VBR MP3. ffmpeg writes the file, not a pipe, so it can go back and fill in the LAME
 * header, which records the encoder's delay and padding for a decoder to trim.
 */
function encode(samples: Float32Array, channels: number, quality: number): Uint8Array {
	const scratch = mkdtempSync(join(tmpdir(), 'sound-loop-'));
	try {
		const file = join(scratch, 'out.mp3');
		ffmpeg(
			[...rawInput(channels), '-i', '-', '-c:a', 'libmp3lame', '-q:a', String(quality), file],
			bytesOf(samples),
		);
		return readFileSync(file);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

/** The MP3 decoded at the output's rate, with the encoder's delay and padding trimmed. */
function decodeMp3(mp3: Uint8Array, channels: number): Float32Array {
	return samplesOf(['-f', 'mp3', '-i', '-', '-ar', String(RATE), '-ac', String(channels)], mp3);
}

/** What the check measured in one output, decoded from its MP3. */
export interface Report {
	readonly name: string;
	readonly seconds: number;
	readonly channels: number;
	readonly bytes: number;
	readonly loudness: number;
	readonly peak: number;
	/** The true peak that the limiter brought down, in dBTP, or null when it did not act. */
	readonly limitedFrom: number | null;
	readonly seam?: number;
	readonly inside?: number;
	readonly padding: { head: number; tail: number };
}

/**
 * The output's MP3, with the gain set again from the decoded MP3 until its level holds: a loop's
 * loudness on its target with its true peak under the ceiling, or a one-shot's true peak just under
 * the ceiling.
 */
function master(sound: Sound, cut: Float32Array): { mp3: Uint8Array; report: Report } {
	const { channels, loudness: target } = sound;
	const pcm = sound.loop
		? crossfadeLoop(cut, channels, Math.round(sound.fade * RATE))
		: fadeOut(cut, channels, Math.round(sound.fade * RATE));
	const start = measure(pcm, channels);
	const peakAim = PEAK_CEILING - PEAK_TOLERANCE / 2;
	let gain = target === null ? peakAim - start.peak : target - start.loudness;
	let ceiling = PEAK_CEILING - 0.5;
	for (let attempt = 0; attempt < 8; attempt++) {
		let level = scaled(pcm, gain);
		const before = measure(level, channels).peak;
		const limited = target !== null && before > ceiling;
		if (limited) level = limit(level, channels, ceiling, sound.loop);
		const mp3 = encode(level, channels, sound.quality);
		const decoded = decodeMp3(mp3, channels);
		const { loudness, peak } = measure(decoded, channels);
		const loudnessOk = target === null || Math.abs(loudness - target) <= LOUDNESS_TOLERANCE;
		const peakOk =
			peak <= PEAK_CEILING && (target !== null || peak >= PEAK_CEILING - PEAK_TOLERANCE);
		if (loudnessOk && peakOk) {
			const steps = sound.loop ? seamSteps(decoded, channels) : {};
			return {
				mp3,
				report: {
					name: sound.name,
					seconds: decoded.length / channels / RATE,
					channels,
					bytes: mp3.length,
					loudness,
					peak,
					limitedFrom: limited ? before : null,
					...steps,
					padding: paddingFrames(decoded, channels),
				},
			};
		}
		if (target === null) gain += peakAim - peak;
		else {
			if (!loudnessOk) gain += target - loudness;
			if (peak > PEAK_CEILING) ceiling -= peak - PEAK_CEILING + 0.1;
		}
	}
	const aim = target === null ? 'a true peak' : `${target} LUFS under`;
	throw new Error(`${sound.name}: no gain gives ${aim} ${PEAK_CEILING} dBTP`);
}

/** Problems with a report that stop the build. */
export function reportProblems(sound: Sound, report: Report): string[] {
	const problems: string[] = [];
	const frames = Math.round(sound.length * RATE);
	if (Math.round(report.seconds * RATE) !== frames)
		problems.push(`${sound.name}: decodes to ${report.seconds} s, not ${sound.length} s`);
	// A one-shot fades out to silence, so only its start must stand clear of the padding level.
	const quiet = report.padding.head + (sound.loop ? report.padding.tail : 0);
	if (quiet > 0)
		problems.push(
			`${sound.name}: ${report.padding.head} frames at its start and ${report.padding.tail} at its end are quieter than the padding level`,
		);
	if (sound.loop && (report.seam ?? 1) > 0.5 * (report.inside ?? 0))
		problems.push(
			`${sound.name}: the seam steps ${report.seam?.toFixed(4)}, against ${report.inside?.toFixed(4)} inside`,
		);
	return problems;
}

/** The folder of raw recordings in the pinned sample content. */
function pinnedRawFolder(): string {
	return dirname(dirname(samplePath('sources/sound/raw/hover/peridactyloptrix-213384.ogg')));
}

if (import.meta.main) {
	const options = parseArgs(process.argv.slice(2));
	const rawFolder = resolve(options.raw ?? pinnedRawFolder());
	const chosen = SOUNDS.filter((sound) => !options.only || options.only.includes(sound.name));
	const problems: string[] = [];
	let total = 0;
	for (const sound of chosen) {
		const { mp3, report } = master(sound, decodeCut(sound, rawFolder));
		const folder = join(resolve(options.out), sound.name);
		mkdirSync(folder, { recursive: true });
		const file = join(folder, `${sound.name}.mp3`);
		writeFileSync(file, mp3);
		total += statSync(file).size;
		problems.push(...reportProblems(sound, report));
		const seam =
			report.seam === undefined
				? 'one-shot'
				: `seam step ${report.seam.toFixed(4)}, largest inside ${report.inside?.toFixed(4)}`;
		console.log(
			`${sound.name}.mp3: ${report.seconds.toFixed(2)} s, ${report.channels === 2 ? 'stereo' : 'mono'}, ${(report.bytes / 1024).toFixed(0)} KB, ${Math.round((report.bytes * 8) / report.seconds / 1000)} kbps; ${report.loudness.toFixed(1)} LUFS, true peak ${report.peak.toFixed(1)} dBTP${report.limitedFrom === null ? '' : ` (limited from ${report.limitedFrom.toFixed(1)})`}; ${seam}`,
		);
		if (options.spectra) {
			mkdirSync(resolve(options.spectra), { recursive: true });
			ffmpeg([
				'-y',
				'-i',
				file,
				'-lavfi',
				'showspectrumpic=s=1200x400:legend=1:scale=log:fscale=log',
				join(resolve(options.spectra), `${sound.name}.png`),
			]);
		}
	}
	console.log(`${chosen.length} sounds, ${(total / 1e6).toFixed(2)} MB`);
	if (problems.length > 0) {
		console.error(problems.map((problem) => `- ${problem}`).join('\n'));
		process.exit(1);
	}
}
