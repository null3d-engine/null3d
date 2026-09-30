// The GPU timer's start mark: a compute pass that runs one invocation of nothing, so every browser
// writes the pass's timestamps. Safari writes none for a pass without work. Its compute entry point
// is `main`.

@compute @workgroup_size(1)
fn main() {}
