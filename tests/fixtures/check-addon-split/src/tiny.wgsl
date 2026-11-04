// A compute shader with no imports, so a build of it costs a compiler start and nothing more.

@compute @workgroup_size(1)
fn main() {}
