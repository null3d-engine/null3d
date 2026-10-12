// Asks the thread that draws for its joined shaders' builds: the times of those that built, and
// those that failed or stayed unbuilt (D-71). Development builds keep them.
import {
	JOIN_TIMING_CHANNEL,
	JOIN_TIMING_REQUEST,
	type JoinTimingReport,
} from '../../../packages/engine/src/gpu/effect-join';

/**
 * The joined shaders' builds that the thread that draws kept, or undefined when no answer comes:
 * a release build keeps none.
 */
export function requestJoinTiming(): Promise<JoinTimingReport | undefined> {
	const channel = new BroadcastChannel(JOIN_TIMING_CHANNEL);
	return new Promise<JoinTimingReport | undefined>((resolve) => {
		const timeout = setTimeout(() => resolve(undefined), 2000);
		channel.onmessage = (event: MessageEvent<JoinTimingReport>) => {
			if (event.data?.type !== 'join-timing') return;
			clearTimeout(timeout);
			resolve(event.data);
		};
		channel.postMessage(JOIN_TIMING_REQUEST);
	}).finally(() => channel.close());
}
