//! The BVHs against brute force: every query of a mesh tree, a top-level tree and the scene's
//! trees must give the answer of testing each triangle and each object in turn. Also the stored
//! format: round trips, determinism, and damaged files that must be refused, never trusted.

mod common;

use std::collections::BTreeSet;

use common::{Rng, Workers, sphere, terrain};
use null3d_core::bvh::capsule::{Capsule, ray_capsule, raycast_capsules};
use null3d_core::bvh::format::{FormatError, HEADER_BYTES};
use null3d_core::bvh::mesh::{
    IndexedTriangles, MeshBvh, Side, TriangleHit, TriangleSoup, Triangles, ray_triangle,
    raycast_brute_force,
};
use null3d_core::bvh::scene::SceneBvh;
use null3d_core::bvh::top::{TopTree, WorldRay, in_cell};
use null3d_core::bvh::{Aabb, NODE_BYTES, Ray, child, sphere_touches_box};
use null3d_core::cells::{CELL_SIZE, CellCoords, CellTable, split};
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::math::{Affine, compose};
use null3d_core::scene::{Command, SceneStorage, flags};

const SIDES: [Side; 3] = [Side::Front, Side::Back, Side::Double];

/// A random triangle soup: `n` triangles of up to `size` across, within `spread` of the origin.
fn soup(rng: &mut Rng, n: usize, spread: f32, size: f32) -> Vec<f32> {
    let mut p = Vec::with_capacity(n * 9);
    for _ in 0..n {
        let c = [(); 3].map(|_| rng.range(-spread, spread));
        for _ in 0..3 {
            for v in c {
                p.push(v + rng.range(-size, size));
            }
        }
    }
    p
}

/// A random ray: from a random point near the box, toward a random point in it, or along an
/// axis, with a far limit now and then.
fn random_ray(rng: &mut Rng, b: &Aabb) -> Ray {
    let pad = 0.5 * (0..3).map(|k| b.max[k] - b.min[k]).fold(1.0f32, f32::max);
    let point = |rng: &mut Rng, pad: f32| -> [f32; 3] {
        std::array::from_fn(|k| rng.range(b.min[k] - pad, b.max[k] + pad))
    };
    let origin = point(rng, pad);
    let direction = match rng.below(4) {
        0 => {
            let mut d = [0.0; 3];
            d[rng.below(3) as usize] = if rng.below(2) == 0 { 1.0 } else { -1.0 };
            d
        }
        1 => [(); 3].map(|_| rng.range(-1.0, 1.0)),
        _ => {
            let target = point(rng, 0.0);
            std::array::from_fn(|k| target[k] - origin[k])
        }
    };
    let mut ray = Ray::new(origin, direction);
    if rng.below(4) == 0 {
        ray.t_max = rng.range(0.0, 2.0);
    }
    ray
}

fn hits_of(mesh: &impl Triangles, ray: &Ray, side: Side) -> BTreeSet<u32> {
    (0..mesh.count())
        .filter(|&i| ray_triangle(ray, &mesh.triangle(i), side).is_some())
        .collect()
}

/// Checks that the tree's closest hit is brute force's: the same distance to the bit, and, on
/// the same triangle, the same hit. Two triangles at the same distance may each be reported.
fn same_closest(got: Option<TriangleHit>, want: Option<TriangleHit>, what: &str) {
    match (got, want) {
        (None, None) => {}
        (Some(g), Some(w)) => {
            assert_eq!(g.t.to_bits(), w.t.to_bits(), "{what}: distance");
            if g.triangle == w.triangle {
                assert_eq!((g.u, g.v, g.front), (w.u, w.v, w.front), "{what}");
            }
        }
        _ => panic!("{what}: tree {got:?}, brute force {want:?}"),
    }
}

/// Every query of a mesh tree against brute force, for `rays` random rays and every side.
fn check_mesh(mesh: &impl Triangles, rng: &mut Rng, rays: u32, what: &str) -> u32 {
    let bvh = MeshBvh::build(mesh).unwrap();
    assert_eq!(bvh.triangle_count(), mesh.count());
    let mut hit = 0;
    for i in 0..rays {
        let ray = random_ray(rng, &bvh.bounds());
        for side in SIDES {
            let want = raycast_brute_force(mesh, &ray, side);
            let got = bvh.raycast(mesh, &ray, side);
            same_closest(got, want, &format!("{what}, ray {i} {ray:?}, {side:?}"));
            assert_eq!(
                bvh.raycast_any(mesh, &ray, side),
                want.is_some(),
                "{what}, ray {i}"
            );
            let mut all = BTreeSet::new();
            bvh.raycast_all(mesh, &ray, side, |h| {
                assert!(all.insert(h.triangle), "{what}: a triangle reported twice");
            });
            assert_eq!(all, hits_of(mesh, &ray, side), "{what}, ray {i}");
            hit += u32::from(want.is_some());
        }
    }
    hit
}

#[test]
fn mesh_trees_give_brute_force_answers() {
    let mut rng = Rng::new(1);
    for n in [1, 2, 3, 4, 5, 17, 100, 3000] {
        let p = soup(&mut rng, n, 10.0, 1.0);
        let hits = check_mesh(
            &TriangleSoup { positions: &p },
            &mut rng,
            300,
            &format!("soup {n}"),
        );
        assert!(
            n < 1000 || hits > 100,
            "the rays should hit a soup of {n} often: {hits}"
        );
    }
    // Long thin triangles across the whole soup, which overlap every box.
    let p = soup(&mut rng, 500, 1.0, 20.0);
    check_mesh(
        &TriangleSoup { positions: &p },
        &mut rng,
        300,
        "long triangles",
    );
    // Shared edges and corners, and axis-aligned rays along grid lines.
    let (positions, indices) = terrain(&mut rng, 40);
    let mesh = IndexedTriangles {
        positions: &positions,
        indices: &indices,
    };
    check_mesh(&mesh, &mut rng, 1000, "terrain");
    let bvh = MeshBvh::build(&mesh).unwrap();
    for x in 0..=40 {
        for side in SIDES {
            let ray = Ray::new([x as f32, 5.0, 20.5], [0.0, -1.0, 0.0]);
            let want = raycast_brute_force(&mesh, &ray, side);
            same_closest(bvh.raycast(&mesh, &ray, side), want, "grid line");
        }
    }
    let (positions, indices) = sphere(24, 32);
    let mesh = IndexedTriangles {
        positions: &positions,
        indices: &indices,
    };
    let hits = check_mesh(&mesh, &mut rng, 1000, "sphere");
    assert!(hits > 500, "{hits}");
    // Many copies of one triangle, and triangles with no area.
    let one = soup(&mut rng, 1, 1.0, 1.0);
    let copies: Vec<f32> = one.iter().copied().cycle().take(9 * 2000).collect();
    check_mesh(
        &TriangleSoup { positions: &copies },
        &mut rng,
        200,
        "copies",
    );
    let flat: Vec<f32> = (0..300)
        .flat_map(|i| {
            let x = i as f32 * 0.01;
            [x, 0.0, 0.0, x + 1.0, 0.0, 0.0, x + 2.0, 0.0, 0.0]
        })
        .collect();
    check_mesh(&TriangleSoup { positions: &flat }, &mut rng, 100, "no area");
}

#[test]
fn identical_triangles_keep_the_tree_within_its_depth() {
    let one = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let copies: Vec<f32> = one.iter().copied().cycle().take(9 * 50_000).collect();
    let mesh = TriangleSoup { positions: &copies };
    let bvh = MeshBvh::build(&mesh).unwrap();
    // A stored tree passes the reader's depth check.
    MeshBvh::from_bytes(&bvh.to_bytes(), &mesh).unwrap();
    let ray = Ray::new([0.2, 0.2, 1.0], [0.0, 0.0, -1.0]);
    let mut n = 0;
    bvh.raycast_all(&mesh, &ray, Side::Front, |_| n += 1);
    assert_eq!(n, 50_000);
}

#[test]
fn refits_follow_moved_vertices() {
    let mut rng = Rng::new(2);
    let (mut positions, indices) = terrain(&mut rng, 30);
    let mut bvh = MeshBvh::build(&IndexedTriangles {
        positions: &positions,
        indices: &indices,
    })
    .unwrap();
    for v in positions.iter_mut() {
        *v += rng.range(-0.7, 0.7);
    }
    let mesh = IndexedTriangles {
        positions: &positions,
        indices: &indices,
    };
    bvh.refit(&mesh);
    for i in 0..1000 {
        let ray = random_ray(&mut rng, &bvh.bounds());
        let want = raycast_brute_force(&mesh, &ray, Side::Double);
        same_closest(
            bvh.raycast(&mesh, &ray, Side::Double),
            want,
            &format!("ray {i}"),
        );
    }
    // The refitted boxes pass the reader's bounds check.
    MeshBvh::from_bytes(&bvh.to_bytes(), &mesh).unwrap();
}

#[test]
fn stored_trees_round_trip_and_builds_repeat_to_the_byte() {
    let mut rng = Rng::new(3);
    for n in [0, 1, 4, 5, 1000] {
        let p = soup(&mut rng, n, 5.0, 1.0);
        let mesh = TriangleSoup { positions: &p };
        let bvh = MeshBvh::build(&mesh).unwrap();
        let bytes = bvh.to_bytes();
        assert_eq!(bytes, MeshBvh::build(&mesh).unwrap().to_bytes());
        assert_eq!(
            bytes.len(),
            HEADER_BYTES + bvh.nodes().len() * NODE_BYTES + n * 4
        );
        assert_eq!(bytes.len() % 4, 0);
        let read = MeshBvh::from_bytes(&bytes, &mesh).unwrap();
        assert_eq!(read, bvh);
        assert!(bvh.memory_bytes() <= 4 * 112 + n * 4 + n * 112 / 2);
    }
}

/// Damaged bytes: each named fault gives its error, and random faults are refused or give a tree
/// that still answers as brute force does.
#[test]
fn damaged_files_are_refused() {
    let mut rng = Rng::new(4);
    let p = soup(&mut rng, 200, 5.0, 1.0);
    let mesh = TriangleSoup { positions: &p };
    let bvh = MeshBvh::build(&mesh).unwrap();
    let good = bvh.to_bytes();
    let nodes = bvh.nodes().len();
    let node_at = |i: usize| HEADER_BYTES + i * NODE_BYTES;
    let child_at = |i: usize, c: usize| node_at(i) + 96 + c * 4;
    let order_at = |e: usize| HEADER_BYTES + nodes * NODE_BYTES + e * 4;
    let put = |bytes: &mut Vec<u8>, at: usize, v: u32| {
        bytes[at..at + 4].copy_from_slice(&v.to_le_bytes())
    };
    let read = |bytes: &[u8]| MeshBvh::from_bytes(bytes, &mesh);
    let other = TriangleSoup { positions: &p[..9] };

    assert_eq!(read(&good[..10]), Err(FormatError::Magic));
    let mut b = good.clone();
    b[0] = b'X';
    assert_eq!(read(&b), Err(FormatError::Magic));
    let mut b = good.clone();
    b[4] = 2;
    assert_eq!(read(&b), Err(FormatError::Version(2, 0)));
    assert!(matches!(
        read(&good[..good.len() - 4]),
        Err(FormatError::Size(..))
    ));
    assert_eq!(
        MeshBvh::from_bytes(&good, &other),
        Err(FormatError::TriangleCount(200, 1))
    );
    let mut b = good.clone();
    put(&mut b, 16, 9);
    assert_eq!(read(&b), Err(FormatError::LeafSize(9)));
    // A child that points back to the root: a loop.
    let (inner, slot) = (0..nodes)
        .flat_map(|i| (0..4).map(move |c| (i, c)))
        .find(|&(i, c)| child::is_node(bvh.nodes()[i].children[c]))
        .unwrap();
    let mut b = good.clone();
    put(&mut b, child_at(inner, slot), 0);
    assert!(matches!(read(&b), Err(FormatError::Child(..))));
    let mut b = good.clone();
    put(&mut b, child_at(inner, slot), nodes as u32);
    assert!(matches!(read(&b), Err(FormatError::Child(..))));
    // A leaf past the order, and a leaf whose triangles another leaf names.
    let (leaf_node, leaf_slot) = (0..nodes)
        .flat_map(|i| (0..4).map(move |c| (i, c)))
        .find(|&(i, c)| child::is_leaf(bvh.nodes()[i].children[c]))
        .unwrap();
    let mut b = good.clone();
    put(&mut b, child_at(leaf_node, leaf_slot), child::leaf(199, 2));
    assert!(matches!(read(&b), Err(FormatError::Leaf(..))));
    let mut b = good.clone();
    let (first, count) = child::leaf_range(bvh.nodes()[leaf_node].children[leaf_slot]);
    put(
        &mut b,
        child_at(leaf_node, leaf_slot),
        child::leaf(if first == 0 { count } else { 0 }, 1),
    );
    assert!(matches!(
        read(&b),
        Err(FormatError::Leaf(..) | FormatError::Unreached(..))
    ));
    // A leaf dropped: its triangles are in no leaf.
    let mut b = good.clone();
    put(&mut b, child_at(leaf_node, leaf_slot), child::EMPTY);
    assert!(matches!(read(&b), Err(FormatError::Unreached(_))));
    // The order names a triangle twice, or one past the mesh.
    let mut b = good.clone();
    let first_tri = bvh.order()[0];
    put(&mut b, order_at(1), first_tri);
    assert!(matches!(read(&b), Err(FormatError::Order(..))));
    let mut b = good.clone();
    put(&mut b, order_at(3), 500);
    assert_eq!(read(&b), Err(FormatError::Order(3, 500)));
    // A box that misses its triangles.
    let mut b = good.clone();
    put(
        &mut b,
        node_at(leaf_node) + 12 * 3 + leaf_slot * 4,
        1e9f32.to_bits(),
    );
    assert!(matches!(read(&b), Err(FormatError::Bounds(..))));
    // A chain deeper than the limit.
    let deep = deep_tree(60);
    assert!(matches!(
        MeshBvh::from_bytes(
            &deep,
            &TriangleSoup {
                positions: &p[..9 * 61]
            }
        ),
        Err(FormatError::Depth(_))
    ));

    // Random damage: refused, or still exact.
    for round in 0..2000 {
        let mut b = good.clone();
        for _ in 0..1 + rng.below(4) {
            let at = rng.below(b.len() as u32) as usize;
            b[at] ^= 1 << rng.below(8);
        }
        if let Ok(tree) = read(&b) {
            for _ in 0..20 {
                let ray = random_ray(&mut rng, &bvh.bounds());
                let want = raycast_brute_force(&mesh, &ray, Side::Double);
                let got = tree.raycast(&mesh, &ray, Side::Double);
                assert_eq!(
                    got.map(|h| h.t.to_bits()),
                    want.map(|h| h.t.to_bits()),
                    "round {round}"
                );
            }
        }
    }
}

/// Stored bytes of a chain of `depth` nodes, each with one triangle and one child node.
fn deep_tree(depth: u32) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend_from_slice(b"N3BV");
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&0u16.to_le_bytes());
    for w in [depth + 1, depth, 4, 0] {
        b.extend_from_slice(&w.to_le_bytes());
    }
    for v in [-1e6f32, -1e6, -1e6, 1e6, 1e6, 1e6] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    for i in 0..depth {
        for k in 0..6 {
            let v = if k < 3 { -1e6f32 } else { 1e6 };
            for _ in 0..4 {
                b.extend_from_slice(&v.to_le_bytes());
            }
        }
        let next = if i + 1 < depth {
            i + 1
        } else {
            child::leaf(depth, 1)
        };
        for w in [child::leaf(i, 1), next, child::EMPTY, child::EMPTY] {
            b.extend_from_slice(&w.to_le_bytes());
        }
    }
    for t in 0..=depth {
        b.extend_from_slice(&t.to_le_bytes());
    }
    b
}

/// A scene for the top-level tests: meshes, and objects that each show one mesh with a world
/// matrix relative to the centre of their cell.
struct Objects {
    meshes: Vec<(Vec<f32>, Vec<u16>, MeshBvh)>,
    mesh_of: Vec<usize>,
    matrices: Vec<Affine>,
    cells: Vec<u32>,
    table: CellTable,
}

impl Objects {
    /// `n` objects around `centre`, spread over `spread` meters.
    fn random(rng: &mut Rng, n: usize, centre: [f64; 3], spread: f64) -> Objects {
        let meshes: Vec<_> = [(6, 8), (12, 16), (2, 3)]
            .into_iter()
            .map(|(r, s)| {
                let (p, i) = sphere(r, s);
                let bvh = MeshBvh::build(&IndexedTriangles {
                    positions: &p,
                    indices: &i,
                })
                .unwrap();
                (p, i, bvh)
            })
            .collect();
        let mut table = CellTable::new();
        let mut objects = Objects {
            meshes,
            mesh_of: Vec::new(),
            matrices: Vec::new(),
            cells: Vec::new(),
            table: CellTable::new(),
        };
        for _ in 0..n {
            let p = [(); 3].map(|_| rng.range(-1.0, 1.0));
            let absolute: [f64; 3] = std::array::from_fn(|k| centre[k] + spread * f64::from(p[k]));
            let (cell, _) = split(absolute.map(|v| v as f32));
            let local = in_cell(absolute, cell);
            let index = table.acquire(cell).unwrap();
            let scale = [(); 3].map(|_| rng.range(0.5, 3.0));
            objects
                .matrices
                .push(compose(local, rng.quaternion(), scale));
            objects.mesh_of.push(rng.below(3) as usize);
            objects.cells.push(index);
        }
        objects.table = table;
        objects
    }

    fn coords(&self, i: usize) -> CellCoords {
        self.table.coords(self.cells[i])
    }

    /// The box around object `i`: its unit sphere's box under its matrix.
    fn bounds(&self, i: usize) -> Aabb {
        let m = &self.matrices[i];
        let r = (0..3)
            .map(|c| (0..3).map(|r| m[r * 4 + c] * m[r * 4 + c]).sum::<f32>())
            .fold(0.0f32, f32::max)
            .sqrt();
        Aabb::of_sphere([m[3], m[7], m[11]], r * 1.0001)
    }

    /// Object `i`'s hit distance for a ray in its cell's frame.
    fn hit(&self, i: usize, ray: &Ray) -> Option<f32> {
        let (p, idx, bvh) = &self.meshes[self.mesh_of[i]];
        let local = ray.to_local(&self.matrices[i])?;
        let mesh = IndexedTriangles {
            positions: p,
            indices: idx,
        };
        bvh.raycast(&mesh, &local, Side::Front).map(|h| h.t)
    }

    /// The nearest object and distance, by testing every object.
    fn brute(&self, ray: &WorldRay) -> Option<(u32, f32)> {
        let mut best: Option<(u32, f32)> = None;
        for i in 0..self.matrices.len() {
            let limit = best.map_or(ray.t_max, |b| b.1);
            if let Some(t) = self.hit(i, &ray.in_cell(self.coords(i)).with_max(limit)) {
                best = Some((i as u32, t));
            }
        }
        best
    }

    fn tree(&self) -> TopTree {
        let mut tree = TopTree::new();
        tree.try_reserve(self.matrices.len() as u32).unwrap();
        for i in 0..self.matrices.len() {
            tree.push(i as u32, self.cells[i], self.bounds(i));
        }
        tree
    }

    /// A ray from near the objects toward one of them.
    fn ray(&self, rng: &mut Rng, centre: [f64; 3], spread: f64) -> WorldRay {
        let i = rng.below(self.matrices.len() as u32) as usize;
        let c = self.coords(i);
        let m = &self.matrices[i];
        let target: [f64; 3] = std::array::from_fn(|k| {
            f64::from(c[k]) * f64::from(CELL_SIZE) + f64::from(m[k * 4 + 3])
        });
        let origin: [f64; 3] =
            std::array::from_fn(|k| centre[k] + spread * 1.5 * f64::from(rng.range(-1.0, 1.0)));
        let mut ray = WorldRay::new(
            origin,
            std::array::from_fn(|k| (target[k] - origin[k]) as f32 + rng.range(-0.5, 0.5)),
        );
        if rng.below(5) == 0 {
            ray.t_max = rng.range(0.0, 1.0);
        }
        ray
    }
}

fn check_tree(objects: &Objects, tree: &TopTree, rng: &mut Rng, centre: [f64; 3], spread: f64) {
    let mut hits = 0;
    for r in 0..200 {
        let ray = objects.ray(rng, centre, spread);
        let want = objects.brute(&ray);
        let got = tree.raycast(&ray, |id, local| objects.hit(id as usize, local));
        match (got, want) {
            (Some(g), Some(w)) => {
                assert_eq!(g.1.to_bits(), w.1.to_bits(), "ray {r}");
                assert!(
                    g.0 == w.0
                        || objects.hit(g.0 as usize, &ray.in_cell(objects.coords(g.0 as usize)))
                            == Some(w.1)
                );
                hits += 1;
            }
            (None, None) => {}
            _ => panic!("ray {r}: tree {got:?}, brute force {want:?}"),
        }
        let any = tree.raycast_any(&ray, |id, local| objects.hit(id as usize, local).is_some());
        assert_eq!(any, want.is_some(), "ray {r}");
        let mut all = BTreeSet::new();
        tree.raycast_all(&ray, |id, local| {
            if objects.hit(id as usize, local).is_some() {
                assert!(all.insert(id));
            }
        });
        let every: BTreeSet<u32> = (0..objects.matrices.len())
            .filter(|&i| objects.hit(i, &ray.in_cell(objects.coords(i))).is_some())
            .map(|i| i as u32)
            .collect();
        assert_eq!(all, every, "ray {r}");
    }
    assert!(hits > 50, "the rays should hit often: {hits}");
    // Overlaps, against each object's box.
    for _ in 0..100 {
        let c: [f64; 3] =
            std::array::from_fn(|k| centre[k] + spread * f64::from(rng.range(-1.0, 1.0)));
        let r = rng.range(0.0, spread as f32 * 0.3);
        let mut got = BTreeSet::new();
        tree.overlap_sphere(c, r, |id, _| assert!(got.insert(id)));
        let want: BTreeSet<u32> = (0..objects.matrices.len())
            .filter(|&i| sphere_touches_box(in_cell(c, objects.coords(i)), r, &objects.bounds(i)))
            .map(|i| i as u32)
            .collect();
        assert_eq!(got, want);
        let half = f64::from(r);
        let (lo, hi) = (c.map(|v| v - half), c.map(|v| v + half));
        let mut got = BTreeSet::new();
        tree.overlap_box(lo, hi, |id, _| assert!(got.insert(id)));
        let want: BTreeSet<u32> = (0..objects.matrices.len())
            .filter(|&i| {
                let q = Aabb {
                    min: in_cell(lo, objects.coords(i)),
                    max: in_cell(hi, objects.coords(i)),
                };
                let b = objects.bounds(i);
                (0..3).all(|k| q.min[k] <= b.max[k] && b.min[k] <= q.max[k])
            })
            .map(|i| i as u32)
            .collect();
        assert_eq!(got, want);
    }
}

#[test]
fn top_trees_give_brute_force_answers_near_and_far_from_the_origin() {
    let workers = Workers::start(3);
    let serial = JobSystem::new(0);
    // At the origin in one cell, across many cells, and on the Earth's surface.
    for (seed, centre, spread, n) in [
        (5, [0.0; 3], 100.0, 500),
        (6, [0.0; 3], 2500.0, 1500),
        (7, [6_378_000.0, 1000.0, -2000.0], 3000.0, 1500),
    ] {
        let mut rng = Rng::new(seed);
        let objects = Objects::random(&mut rng, n, centre, spread);
        let mut tree = objects.tree();
        tree.build_sah(&objects.table, workers.jobs()).unwrap();
        check_tree(&objects, &tree, &mut rng, centre, spread);
        let mut morton = objects.tree();
        morton.build_morton(&objects.table, workers.jobs()).unwrap();
        check_tree(&objects, &morton, &mut rng, centre, spread);
        // The same trees with no job workers.
        let mut alone = objects.tree();
        alone.build_morton(&objects.table, &serial).unwrap();
        assert_eq!(alone.roots(), morton.roots());
        assert_eq!(alone.nodes(), morton.nodes());
        alone.build_sah(&objects.table, &serial).unwrap();
        assert_eq!(alone.roots(), tree.roots());
        assert_eq!(alone.nodes(), tree.nodes());
    }
}

#[test]
fn far_rays_are_as_precise_as_near_ones() {
    // The same objects at the origin and 6,378 km away, hit by the same rays relative to them.
    let mut rng = Rng::new(8);
    let near = Objects::random(&mut rng, 200, [0.0; 3], 50.0);
    let shift = [6_378_000.0, 0.0, 0.0];
    let mut far = Objects::random(&mut Rng::new(8), 200, shift, 50.0);
    // Same local matrices; only the cells differ.
    far.matrices.clone_from(&near.matrices);
    far.mesh_of.clone_from(&near.mesh_of);
    let mut table = CellTable::new();
    let base = split(shift.map(|v| v as f32)).0;
    far.cells = (0..200)
        .map(|i| {
            let c = near.coords(i);
            table
                .acquire(std::array::from_fn(|k| c[k] + base[k]))
                .unwrap()
        })
        .collect();
    far.table = table;
    let (mut a, mut b) = (near.tree(), far.tree());
    a.build_sah(&near.table, &JobSystem::new(0)).unwrap();
    b.build_sah(&far.table, &JobSystem::new(0)).unwrap();
    let offset: [f64; 3] = std::array::from_fn(|k| f64::from(base[k]) * f64::from(CELL_SIZE));
    for _ in 0..300 {
        let ray = near.ray(&mut rng, [0.0; 3], 50.0);
        let moved = WorldRay {
            origin: std::array::from_fn(|k| ray.origin[k] + offset[k]),
            ..ray
        };
        let x = a.raycast(&ray, |id, l| near.hit(id as usize, l));
        let y = b.raycast(&moved, |id, l| far.hit(id as usize, l));
        assert_eq!(x, y);
    }
}

#[test]
fn refits_follow_moved_items() {
    let mut rng = Rng::new(9);
    let mut objects = Objects::random(&mut rng, 1000, [0.0; 3], 300.0);
    let mut tree = objects.tree();
    tree.build_sah(&objects.table, &JobSystem::new(0)).unwrap();
    for (i, m) in objects.matrices.iter_mut().enumerate() {
        if i % 3 == 0 {
            m[3] += rng.range(-20.0, 20.0);
            m[7] += rng.range(-20.0, 20.0);
        }
    }
    for i in 0..1000 {
        tree.set(i, objects.cells[i as usize], objects.bounds(i as usize));
    }
    tree.refit();
    check_tree(&objects, &tree, &mut rng, [0.0; 3], 300.0);
}

#[test]
fn capsules_hit_where_their_surface_is() {
    let mut rng = Rng::new(10);
    let capsules: Vec<Capsule> = (0..20)
        .map(|_| Capsule {
            a: [(); 3].map(|_| rng.range(-5.0, 5.0)),
            b: [(); 3].map(|_| rng.range(-5.0, 5.0)),
            radius: rng.range(0.1, 1.0),
        })
        .collect();
    let distance = |c: &Capsule, p: [f32; 3]| {
        let ab: [f32; 3] = std::array::from_fn(|k| c.b[k] - c.a[k]);
        let ap: [f32; 3] = std::array::from_fn(|k| p[k] - c.a[k]);
        let len2: f32 = ab.iter().map(|v| v * v).sum();
        let s = if len2 > 0.0 {
            (ap.iter().zip(&ab).map(|(a, b)| a * b).sum::<f32>() / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        (0..3)
            .map(|k| (p[k] - c.a[k] - s * ab[k]).powi(2))
            .sum::<f32>()
            .sqrt()
            - c.radius
    };
    let mut hits = 0;
    for _ in 0..800 {
        let ray = random_ray(
            &mut rng,
            &Aabb {
                min: [-5.0; 3],
                max: [5.0; 3],
            },
        );
        let len = ray.direction.iter().map(|v| v * v).sum::<f32>().sqrt();
        let got = raycast_capsules(&ray, &capsules);
        // March along the ray: the first point inside a capsule that the ray starts outside.
        let outside: Vec<&Capsule> = capsules
            .iter()
            .filter(|c| distance(c, ray.origin) >= 0.0)
            .collect();
        let mut first = None;
        let steps = 1500;
        let end = ray.t_max.min(40.0 / len);
        for s in 0..=steps {
            let t = end * s as f32 / steps as f32;
            if outside.iter().any(|c| distance(c, ray.at(t)) < 0.0) {
                first = Some(t);
                break;
            }
        }
        let step = end / steps as f32;
        match (got, first) {
            (Some((i, t)), Some(m)) => {
                hits += 1;
                assert!(
                    (t - m).abs() <= step * 1.5 + 1e-4,
                    "hit at {t}, march at {m}"
                );
                assert!(distance(&capsules[i as usize], ray.at(t)).abs() < 1e-3 * (1.0 + t * len));
                assert_eq!(ray_capsule(&ray, &capsules[i as usize]), Some(t));
            }
            (None, None) => {}
            // A ray that starts inside a capsule, or grazes one between march steps.
            (None, Some(m)) => assert!(m == 0.0 || m < step * 2.0, "missed at {m}"),
            (Some((_, t)), None) => assert!(t >= end - step, "hit at {t} the march missed"),
        }
    }
    assert!(hits > 60, "{hits}");
}

/// The scene's trees across frames of creates, moves, cell changes and destroys, against brute
/// force over the scene's own world output.
#[test]
fn scene_trees_follow_the_scene() {
    let workers = Workers::start(3);
    let jobs = workers.jobs();
    let mut rng = Rng::new(11);
    let (p, i) = sphere(8, 12);
    let mesh_bvh = MeshBvh::build(&IndexedTriangles {
        positions: &p,
        indices: &i,
    })
    .unwrap();
    let mesh = IndexedTriangles {
        positions: &p,
        indices: &i,
    };
    let mut scene = SceneStorage::with_capacity(4000);
    let batches = BatchTable::with_capacity(1);
    let mut live: Vec<(Handle, bool)> = Vec::new();
    let mut bvh = SceneBvh::new();
    let bounds = |_| mesh_bvh.bounds();
    let far = [6_378_000.0f32, 0.0, 0.0];
    let position = |rng: &mut Rng| -> [f32; 3] {
        let base = if rng.below(4) == 0 { far } else { [0.0; 3] };
        std::array::from_fn(|k| base[k] + rng.range(-3000.0, 3000.0))
    };
    for frame in 1..=12u32 {
        let mut commands = Vec::new();
        for _ in 0..if frame == 1 { 800 } else { 40 } {
            let h = scene.reserve().unwrap();
            let dynamic = rng.below(3) == 0;
            scene.set_position(h, position(&mut rng)).unwrap();
            scene.set_rotation(h, rng.quaternion()).unwrap();
            scene
                .set_scale(h, [(); 3].map(|_| rng.range(1.0, 30.0)))
                .unwrap();
            scene.set_local_radius(h, 1.0001).unwrap();
            let f = flags::VISIBLE | if dynamic { flags::DYNAMIC } else { 0 };
            commands.push(Command::create(h, Handle::NONE, 1, f));
            live.push((h, dynamic));
        }
        if frame > 1 {
            for _ in 0..20 {
                let k = rng.below(live.len() as u32) as usize;
                commands.push(Command::destroy(live.swap_remove(k).0));
            }
            for _ in 0..10 {
                let k = rng.below(live.len() as u32) as usize;
                commands.push(Command::set_visible(live[k].0, rng.below(2) == 0));
            }
        }
        scene.apply_commands(&commands, frame).unwrap();
        // Dynamic objects move every frame; some static ones move within or across cells.
        for &(h, dynamic) in &live {
            if dynamic || rng.below(20) == 0 {
                let slot = scene.resolve(h).unwrap() as usize;
                let at = if rng.below(2) == 0 {
                    position(&mut rng)
                } else {
                    let q = &scene.positions()[slot * 3..slot * 3 + 3];
                    [q[0] + rng.range(-5.0, 5.0), q[1], q[2]]
                };
                if dynamic {
                    scene.positions_mut()[slot * 3..slot * 3 + 3].copy_from_slice(&at);
                } else {
                    scene.set_position(h, at).unwrap();
                }
            }
        }
        scene.update_transforms(jobs);
        bvh.sync(&scene, &batches, jobs, &bounds).unwrap();
        // A second sync of the same frame changes nothing.
        bvh.sync(&scene, &batches, jobs, &bounds).unwrap();
        let world = scene.world((frame & 1) as usize);
        let table = scene.cell_table();
        let hit = |slot: u32, ray: &Ray| {
            let local = ray.to_local(world.matrix(slot as usize))?;
            mesh_bvh.raycast(&mesh, &local, Side::Front).map(|h| h.t)
        };
        let slots: Vec<u32> = scene.created().iter_ones().collect();
        let in_frame =
            |slot: u32, ray: &WorldRay| ray.in_cell(table.coords(scene.cells()[slot as usize]));
        let mut hits = 0;
        for r in 0..150 {
            let target = slots[rng.below(slots.len() as u32) as usize];
            let m = world.matrix(target as usize);
            let c = table.coords(scene.cells()[target as usize]);
            let goal: [f64; 3] = std::array::from_fn(|k| {
                f64::from(c[k]) * f64::from(CELL_SIZE) + f64::from(m[k * 4 + 3])
            });
            let origin: [f64; 3] =
                std::array::from_fn(|k| goal[k] + f64::from(rng.range(-500.0, 500.0)));
            let ray = WorldRay::new(
                origin,
                std::array::from_fn(|k| (goal[k] - origin[k]) as f32 + rng.range(-5.0, 5.0)),
            );
            let mut want: Option<(u32, f32)> = None;
            for &slot in &slots {
                if world.radii()[slot as usize] < 0.0 {
                    continue;
                }
                let limit = want.map_or(ray.t_max, |w| w.1);
                if let Some(t) = hit(slot, &in_frame(slot, &ray).with_max(limit)) {
                    want = Some((slot, t));
                }
            }
            let got = bvh.raycast(&ray, hit);
            assert_eq!(
                got.map(|g| g.1.to_bits()),
                want.map(|w| w.1.to_bits()),
                "frame {frame}, ray {r}"
            );
            hits += u32::from(want.is_some());
            assert_eq!(
                bvh.raycast_any(&ray, |s, l| hit(s, l).is_some()),
                want.is_some()
            );
        }
        assert!(hits > 50, "frame {frame}: {hits} hits");
        // Every live object is in exactly one tree.
        let mut ids: Vec<u32> = bvh
            .statics()
            .ids()
            .iter()
            .chain(bvh.dynamics().ids())
            .copied()
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, slots);
    }
}
