// Lets a test sketch wrap another sketch: it hands the inner sketch its context with some members
// replaced, such as a scene whose setActiveCamera also records the camera.

/** `target` with some of its members replaced, and its methods bound to it. */
export function withMembers<T extends object>(target: T, members: Partial<T>): T {
	return new Proxy(target, {
		get(object, key) {
			if (key in members) return members[key as keyof T];
			const value = Reflect.get(object, key, object);
			return typeof value === 'function' ? value.bind(object) : value;
		},
	});
}
