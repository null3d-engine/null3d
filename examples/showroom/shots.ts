// The camera's route: the shots of the showroom's loop, in the order that the camera plays them.
// The owner set it: the loop opens and settles on the same view, looking at the configurator with
// the car beside it, and between them the camera turns around the car in the studio, follows it out
// to the street, watches it turn, and comes back in front of it as it returns. The route takes the
// same time as the car's loop, so the two meet at the seam.
import type { Shot } from '../lib/cinematic';

/**
 * The shots, whose lengths add up to the car's loop. Each shot moves the camera from its own pose to
 * the next shot's, so a pose is where the camera arrives at the start of its shot; the first holds,
 * which pins the frame that a held picture test draws, and the last ends on that same pose.
 */
export const SHOTS: readonly Shot[] = [
	{ position: [8, 2.6, 3.6], target: [2.4, 1.05, 9.9], seconds: 3, move: 'hold' },
	// The same view again, so the opening holds before the camera moves off it. It then swings round
	// the car's front to its far side.
	{ position: [8, 2.6, 3.6], target: [2.4, 1.05, 9.9], seconds: 5 },
	// Round to the car's far flank as it turns for the opening.
	{ position: [-6.5, 2.5, 4.6], target: [0, 0.95, 9], seconds: 4 },
	// Behind it in the studio, ready to follow it out.
	{ position: [1.2, 2.9, 11], target: [0, 0.9, 4], seconds: 6 },
	// Down at the street's far end, where the car turns after the camera follows it out.
	{ position: [4, 2.2, -21], target: [0, 1, -30], seconds: 4 },
	// Backing away in front of it as it returns, so it stays in frame all the way in.
	{ position: [4.5, 2.4, -18], target: [0, 1, -28], seconds: 6 },
	// In the studio behind it, easing round to the view the loop opens with.
	{ position: [4.5, 2.4, 16], target: [0, 1, 6], seconds: 8 },
];
