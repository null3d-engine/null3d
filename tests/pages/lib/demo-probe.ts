// What the demo probe sketch reports: where a live demo's camera and its moving objects are.

/** The probe's report, in world coordinates. */
export interface DemoProbe {
	/** The sketch time of the frame that answered, in seconds. */
	time: number;
	/** The active camera's place. */
	camera: number[];
	/** The places of the demo's dynamic meshes and point lights, in the order the demo made them. */
	objects: number[][];
}
