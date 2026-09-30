// GPU culling. One thread per instance tests the instance's bounding sphere against the six
// frustum planes and appends each survivor to its bucket's slice of the compacted instance buffer,
// raising the instance count of the bucket's indirect draws with atomic adds. A bucket has one
// draw per part of its mesh, and each part's draw reads the same slice, so every draw of the
// bucket counts each survivor. The sphere comes from the world matrix: its center is the
// translation, and its radius is the mesh's radius times the largest axis scale.

struct CullParams {
    planes: array<vec4f, 6>,
    instance_count: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

/// A bucket: one pipeline, mesh and material, with its slice of the compacted instance buffer and
/// its indirect draws, one per part of the mesh, from `first_draw` on.
struct Bucket {
    base: u32,
    material: u32,
    radius: f32,
    first_draw: u32,
    draws: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

@group(0) @binding(0) var<uniform> params: CullParams;
@group(0) @binding(1) var<storage, read> matrices: array<vec4f>;
@group(0) @binding(2) var<storage, read> instance_buckets: array<u32>;
@group(0) @binding(3) var<storage, read> buckets: array<Bucket>;
@group(0) @binding(4) var<storage, read_write> visible: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> indirect: array<atomic<u32>>;

/// The bucket of an instance that draws nowhere.
const HIDDEN: u32 = 0xffffffffu;
/// 32-bit words of one indexed indirect draw: index count, instance count, first index, base
/// vertex, first instance.
const INDIRECT_WORDS: u32 = 5u;

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if i >= params.instance_count {
        return;
    }
    let b = instance_buckets[i];
    if b == HIDDEN {
        return;
    }
    let r0 = matrices[i * 3u];
    let r1 = matrices[i * 3u + 1u];
    let r2 = matrices[i * 3u + 2u];
    let center = vec3f(r0.w, r1.w, r2.w);
    let scale = max(
        length(vec3f(r0.x, r1.x, r2.x)),
        max(length(vec3f(r0.y, r1.y, r2.y)), length(vec3f(r0.z, r1.z, r2.z))),
    );
    let bucket = buckets[b];
    let radius = bucket.radius * scale;
    for (var p = 0u; p < 6u; p++) {
        let plane = params.planes[p];
        if dot(plane.xyz, center) + plane.w < -radius {
            return;
        }
    }
    let slot = atomicAdd(&indirect[bucket.first_draw * INDIRECT_WORDS + 1u], 1u);
    for (var d = 1u; d < bucket.draws; d++) {
        atomicAdd(&indirect[(bucket.first_draw + d) * INDIRECT_WORDS + 1u], 1u);
    }
    let dst = (bucket.base + slot) * 4u;
    visible[dst] = r0;
    visible[dst + 1u] = r1;
    visible[dst + 2u] = r2;
    visible[dst + 3u] = bitcast<vec4f>(vec4u(bucket.material, 0u, 0u, 0u));
}
