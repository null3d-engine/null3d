import { describe, expect, it } from 'bun:test';
import { type HeatSample, heatText, parseHeat, summarizeHeat } from './heat.ts';

/** A reading from a Galaxy S24+ that Samsung throttles: its fastest cores are capped. */
const SAMSUNG_READING = `samsung=2
cores=policy0,1632000,1959000
cores=policy4,1824000,2592000
cores=policy7,1824000,2900000
cores=policy9,1824000,3207000
  level: 55
  temperature: 386
Thermal Status: 0
Current temperatures from HAL:
	Temperature{mValue=53.4, mType=0, mName=AP, mStatus=0}
	Temperature{mValue=38.6, mType=2, mName=BAT, mStatus=0}
	Temperature{mValue=40.0, mType=3, mName=SKIN, mStatus=0}
	Temperature{mValue=0.0, mType=2, mName=SUBBAT, mStatus=0}
	Temperature{mValue=34.1, mType=4, mName=USB, mStatus=0}
Current cooling devices from HAL:
`;

/** A reading from a phone without Samsung's level whose shell may not read the core speeds. */
const OTHER_READING = `samsung=
cores=policy0,,
  level: 80
  temperature: 301
Thermal Status: 1
Current temperatures from HAL:
	Temperature{mValue=41.5, mType=0, mName=cpu0, mStatus=1}
	Temperature{mValue=44.0, mType=0, mName=cpu4, mStatus=1}
Current cooling devices from HAL:
`;

const sample = (at: number, skinC: number, allowedKhz: number, samsungLevel = 0): HeatSample => ({
	at,
	thermalStatus: 0,
	samsungLevel,
	processorC: skinC + 10,
	skinC,
	batteryC: skinC - 1,
	batteryLevel: 60,
	cores: [
		{ group: 'policy0', allowedKhz: 1_000_000, topKhz: 1_000_000 },
		{ group: 'policy9', allowedKhz, topKhz: 3_000_000 },
	],
});

describe('parseHeat', () => {
	it("reads a Samsung phone's level, core speeds, battery and temperatures", () => {
		expect(parseHeat(SAMSUNG_READING, 1000)).toEqual({
			at: 1000,
			thermalStatus: 0,
			samsungLevel: 2,
			processorC: 53.4,
			skinC: 40,
			batteryC: 38.6,
			batteryLevel: 55,
			cores: [
				{ group: 'policy0', allowedKhz: 1632000, topKhz: 1959000 },
				{ group: 'policy4', allowedKhz: 1824000, topKhz: 2592000 },
				{ group: 'policy7', allowedKhz: 1824000, topKhz: 2900000 },
				{ group: 'policy9', allowedKhz: 1824000, topKhz: 3207000 },
			],
		});
	});

	it('leaves out what a phone does not report, and takes the hottest processor sensor', () => {
		expect(parseHeat(OTHER_READING, 2000)).toEqual({
			at: 2000,
			thermalStatus: 1,
			samsungLevel: null,
			processorC: 44,
			skinC: null,
			batteryC: 30.1,
			batteryLevel: 80,
			cores: [],
		});
	});
});

describe('summarizeHeat', () => {
	const log = [
		sample(1000, 36, 3_000_000, -1),
		sample(2000, 38, 2_400_000, 1),
		sample(3000, 40, 1_800_000, 2),
	];

	it('takes the readings in the window, with the last one before it as the start', () => {
		expect(summarizeHeat(log, 1500, 3000)).toEqual({
			readings: 3,
			skinC: { start: 36, end: 40, max: 40 },
			batteryC: { start: 35, end: 39 },
			processorMaxC: 50,
			samsungLevelMax: 2,
			thermalStatusMax: 0,
			fastestCoresMinShare: 0.6,
		});
		expect(summarizeHeat(log, 2000, 2500)?.readings).toBe(1);
		expect(summarizeHeat(log, 0, 500)).toBeUndefined();
	});

	it('says the heat in one line', () => {
		const heat = summarizeHeat(log, 1500, 3000);
		expect(heat && heatText(heat)).toBe(
			'skin 36.0 °C to 40.0 °C, peak 40.0 °C, battery 35.0 °C to 39.0 °C, processor peak 50.0 °C, Samsung throttle level up to 2, fastest cores allowed 60% of top speed at the lowest',
		);
	});
});
