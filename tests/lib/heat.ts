// The heat state of an Android phone, read over adb while a run goes on: its temperatures, the
// speed its cores may reach, and Samsung's own throttle level. A phone slows down as it heats up, so
// each result records the heat it ran in.
import { phoneShell } from './adb.ts';

/** How often a heat log reads the phone. One reading takes the phone a fraction of a second. */
export const HEAT_INTERVAL_MS = 10_000;

/** One reading of a phone's heat state. A value the phone does not report is null. */
export interface HeatSample {
	/** When the reading finished, in milliseconds since 1970 on this computer. */
	at: number;
	/** Android's thermal status, from 0 (none) to 6 (shutdown). */
	thermalStatus: number | null;
	/**
	 * Samsung's own throttle level, which caps the cores long before Android's status rises: 0 or
	 * less when it throttles nothing. Null on other phones.
	 */
	samsungLevel: number | null;
	/** The hottest processor sensor, in degrees Celsius. */
	processorC: number | null;
	/** The hottest skin sensor, in degrees Celsius. */
	skinC: number | null;
	/** The battery's temperature in degrees Celsius, and its charge in percent. */
	batteryC: number | null;
	batteryLevel: number | null;
	/** Each group of cores: the speed it may reach now, and its top speed, in kHz. */
	cores: { group: string; allowedKhz: number; topKhz: number }[];
}

/** Temperature types in Android's thermal service. */
const TYPE_CPU = 0;
const TYPE_SKIN = 3;

/** Prints one reading. A value the phone does not let the shell read prints as nothing. */
const HEAT_SCRIPT = [
	'echo "samsung=$(getprop sys.siop.level)"',
	'for p in /sys/devices/system/cpu/cpufreq/policy*; do',
	'  echo "cores=$(basename $p),$(cat $p/scaling_max_freq 2>/dev/null),$(cat $p/cpuinfo_max_freq 2>/dev/null)"',
	'done',
	"dumpsys battery | grep -E '^ +(level|temperature):'",
	"dumpsys thermalservice | sed -n '/^Thermal Status:/p;/^Current temperatures from HAL/,/^Current cooling devices/p'",
].join('\n');

const hottest = (current: number | null, value: number) =>
	current === null ? value : Math.max(current, value);

/** What each line of a reading sets in the sample. */
const LINE_READERS: [RegExp, (sample: HeatSample, match: RegExpMatchArray) => void][] = [
	[
		/^samsung=(-?\d+)$/,
		(s, m) => {
			s.samsungLevel = Number(m[1]);
		},
	],
	[
		/^cores=([\w-]+),(\d+),(\d+)$/,
		(s, m) =>
			s.cores.push({ group: m[1] as string, allowedKhz: Number(m[2]), topKhz: Number(m[3]) }),
	],
	[
		/^level: (\d+)$/,
		(s, m) => {
			s.batteryLevel = Number(m[1]);
		},
	],
	// The battery service gives tenths of a degree.
	[
		/^temperature: (-?\d+)$/,
		(s, m) => {
			s.batteryC = Number(m[1]) / 10;
		},
	],
	[
		/^Thermal Status: (\d+)$/,
		(s, m) => {
			s.thermalStatus = Number(m[1]);
		},
	],
	[
		/mValue=(-?[\d.]+), mType=(\d+)/,
		(s, m) => {
			const value = Number(m[1]);
			if (Number(m[2]) === TYPE_CPU) s.processorC = hottest(s.processorC, value);
			else if (Number(m[2]) === TYPE_SKIN) s.skinC = hottest(s.skinC, value);
		},
	],
];

/** Reads what the heat script printed, taken at time `at`. */
export function parseHeat(output: string, at: number): HeatSample {
	const sample: HeatSample = {
		at,
		thermalStatus: null,
		samsungLevel: null,
		processorC: null,
		skinC: null,
		batteryC: null,
		batteryLevel: null,
		cores: [],
	};
	for (const line of output.split('\n')) {
		const text = line.trim();
		for (const [pattern, read] of LINE_READERS) {
			const match = text.match(pattern);
			if (match) {
				read(sample, match);
				break;
			}
		}
	}
	return sample;
}

/** Reads the phone's heat state now, or undefined when the phone does not answer. */
export async function readHeat(): Promise<HeatSample | undefined> {
	try {
		return parseHeat(await phoneShell(HEAT_SCRIPT), Date.now());
	} catch {
		// A reading that fails, as when the cable moves, leaves a gap in the log.
		return undefined;
	}
}

/** Reads the phone's heat state at a steady beat until stopped, one reading at a time. */
export class HeatLog {
	readonly samples: HeatSample[] = [];
	private timer: ReturnType<typeof setInterval> | undefined;
	private reading: Promise<void> = Promise.resolve();

	start(): void {
		this.read();
		this.timer = setInterval(() => this.read(), HEAT_INTERVAL_MS);
	}

	/** Stops after one last reading, and returns every reading in time order. */
	async stop(): Promise<HeatSample[]> {
		clearInterval(this.timer);
		this.read();
		await this.reading;
		return this.samples;
	}

	private read(): void {
		this.reading = this.reading.then(async () => {
			const sample = await readHeat();
			if (sample) this.samples.push(sample);
		});
	}
}

/** The heat one page or one run ran in. */
export interface HeatSummary {
	/** The number of readings it rests on. */
	readings: number;
	/** Skin and battery temperatures at the start and the end, and the skin's peak, in °C. */
	skinC: { start: number; end: number; max: number } | null;
	batteryC: { start: number; end: number } | null;
	/** The hottest processor reading, in °C. */
	processorMaxC: number | null;
	/** The highest Samsung throttle level and Android thermal status. */
	samsungLevelMax: number | null;
	thermalStatusMax: number | null;
	/** The lowest speed the fastest group of cores was allowed, as a share of its top speed. */
	fastestCoresMinShare: number | null;
}

const known = (values: (number | null)[]) => values.filter((v): v is number => v !== null);

/**
 * The heat between two times: the readings in that window, with the last reading before it as the
 * state at the start. Undefined when there is no reading.
 */
export function summarizeHeat(
	samples: readonly HeatSample[],
	from: number,
	to: number,
): HeatSummary | undefined {
	const before = samples.filter((s) => s.at <= from).at(-1);
	const window = [...(before ? [before] : []), ...samples.filter((s) => s.at > from && s.at <= to)];
	if (window.length === 0) return undefined;
	const skin = known(window.map((s) => s.skinC));
	const battery = known(window.map((s) => s.batteryC));
	const max = (values: number[]) => (values.length > 0 ? Math.max(...values) : null);
	const fastest = window.flatMap((s) => {
		const top = s.cores.reduce<HeatSample['cores'][number] | undefined>(
			(best, group) => (!best || group.topKhz > best.topKhz ? group : best),
			undefined,
		);
		return top && top.topKhz > 0 ? [top.allowedKhz / top.topKhz] : [];
	});
	return {
		readings: window.length,
		skinC:
			skin.length > 0
				? { start: skin[0] as number, end: skin.at(-1) as number, max: Math.max(...skin) }
				: null,
		batteryC:
			battery.length > 0 ? { start: battery[0] as number, end: battery.at(-1) as number } : null,
		processorMaxC: max(known(window.map((s) => s.processorC))),
		samsungLevelMax: max(known(window.map((s) => s.samsungLevel))),
		thermalStatusMax: max(known(window.map((s) => s.thermalStatus))),
		fastestCoresMinShare: fastest.length > 0 ? Math.min(...fastest) : null,
	};
}

/** The heat as one line, for a report. */
export function heatText(heat: HeatSummary): string {
	const degrees = (value: number) => `${value.toFixed(1)} °C`;
	const parts: string[] = [];
	if (heat.skinC)
		parts.push(
			`skin ${degrees(heat.skinC.start)} to ${degrees(heat.skinC.end)}, peak ${degrees(heat.skinC.max)}`,
		);
	if (heat.batteryC)
		parts.push(`battery ${degrees(heat.batteryC.start)} to ${degrees(heat.batteryC.end)}`);
	if (heat.processorMaxC !== null) parts.push(`processor peak ${degrees(heat.processorMaxC)}`);
	if (heat.samsungLevelMax !== null)
		parts.push(`Samsung throttle level up to ${Math.max(0, heat.samsungLevelMax)}`);
	if (heat.thermalStatusMax) parts.push(`Android thermal status up to ${heat.thermalStatusMax}`);
	if (heat.fastestCoresMinShare !== null)
		parts.push(
			`fastest cores allowed ${Math.round(heat.fastestCoresMinShare * 100)}% of top speed at the lowest`,
		);
	return parts.length > 0 ? parts.join(', ') : 'no heat readings';
}
