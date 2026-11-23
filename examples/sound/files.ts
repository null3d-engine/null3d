// The recordings that the sound demo plays, from the sample content. Each address is a string
// literal, which the sample check reads to pin the file.
import { sampleUrl } from '../lib/samples';

export const RECORDINGS = {
	rain: sampleUrl('sources/sound/rain/rain.mp3'),
	stream: sampleUrl('sources/sound/stream/stream.mp3'),
	thunderNear: sampleUrl('sources/sound/thunder-near/thunder-near.mp3'),
	thunderFar: sampleUrl('sources/sound/thunder-far/thunder-far.mp3'),
};
