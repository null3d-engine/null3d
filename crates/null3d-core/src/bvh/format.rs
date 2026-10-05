//! The stored form of a mesh tree: the bytes that the asset tool writes into a model file, so the
//! engine loads the tree instead of building it.
//!
//! The engine and the tool use this one module, built to WebAssembly for the tool, so the format
//! has a single source. Every number is little-endian, and the record sizes are multiples of 4,
//! as a glTF buffer view needs.
//!
//! | Offset | Size | Field |
//! | --- | --- | --- |
//! | 0 | 4 | Magic: the bytes `N3BV` |
//! | 4 | 2 | Version: [`VERSION`] |
//! | 6 | 2 | Flags: 0; a reader refuses any other value |
//! | 8 | 4 | Triangle count `t` |
//! | 12 | 4 | Node count `n` |
//! | 16 | 4 | Most triangles per leaf |
//! | 20 | 4 | Reserved: 0 |
//! | 24 | 24 | The box around every triangle: min x, y, z, then max x, y, z |
//! | 48 | 112 × `n` | Nodes: min x, y, z of the four children (4 floats each), max x, y, z, then the four child words |
//! | 48 + 112 × `n` | 4 × `t` | The triangle index of each leaf entry |
//!
//! Node 0 is the root. A child word is a node index, a leaf, or empty, as [`super::child`]
//! describes, and every child node comes after its parent.
//!
//! # Reading
//!
//! [`read`] checks everything a damaged or hostile file could get wrong, and returns an error
//! instead of a tree that loops, reads past an array, or misses a triangle: the sizes, each child
//! word, that each node has one parent that comes before it, the depth, that the leaves name
//! every entry of the order once, that the order names every triangle once, that every box is
//! finite and holds what lies under it, and that every empty slot holds the empty box that
//! [`write`] gives it. A tree that passes gives the same hits as one the engine builds, though its
//! shape may differ.

use std::fmt;

use super::mesh::{MeshBvh, Triangles};
use super::{Aabb, MAX_DEPTH, NODE_BYTES, Node, child};

/// The bytes a file starts with.
pub const MAGIC: [u8; 4] = *b"N3BV";
/// The format version this module writes and reads.
pub const VERSION: u16 = 1;
/// Bytes before the first node.
pub const HEADER_BYTES: usize = 48;

/// Why stored bytes are not a tree for the mesh.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FormatError {
    /// The bytes do not start with [`MAGIC`].
    Magic,
    /// The version or flags are ones this reader does not know: the version, and the flags.
    Version(u16, u16),
    /// The byte count is not the one the header implies: the count, and the one expected.
    Size(usize, usize),
    /// The tree's triangle count differs from the mesh's: the tree's, and the mesh's.
    TriangleCount(u32, u32),
    /// The leaf size is 0 or over [`child::MAX_LEAF_COUNT`]: the leaf size.
    LeafSize(u32),
    /// A node is missing, or a child word names a node that does not come after its parent, or
    /// one that another child already names: the node, and the child word.
    Child(u32, u32),
    /// A leaf runs past the order array, or names an entry that another leaf names: the node,
    /// and the leaf's word.
    Leaf(u32, u32),
    /// Some entries of the order array are in no leaf: how many.
    Unreached(u32),
    /// The order names a triangle twice, or one past the mesh: the entry, and the triangle.
    Order(u32, u32),
    /// A node lies deeper than [`MAX_DEPTH`]: the node.
    Depth(u32),
    /// A box does not hold what lies under it, or is not finite: the node, and the child, or 4
    /// for the box around every triangle.
    Bounds(u32, u32),
    /// An empty child slot holds a box other than the empty one: the node, and the slot. A query
    /// that tests such a slot would follow its empty word.
    EmptySlot(u32, u32),
    /// Memory could not grow for the tree: the bytes it needed.
    OutOfMemory(usize),
}

impl fmt::Display for FormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            Self::Magic => write!(f, "the data is not a stored BVH"),
            Self::Version(v, flags) => {
                write!(
                    f,
                    "BVH version {v} with flags {flags} is not version {VERSION}"
                )
            }
            Self::Size(got, want) => write!(f, "the BVH holds {got} bytes, not {want}"),
            Self::TriangleCount(tree, mesh) => {
                write!(f, "the BVH has {tree} triangles and the mesh {mesh}")
            }
            Self::LeafSize(n) => write!(f, "a leaf size of {n} is not allowed"),
            Self::Child(node, word) => write!(f, "node {node} has a bad child {word:#x}"),
            Self::Leaf(node, word) => write!(f, "node {node} has a bad leaf {word:#x}"),
            Self::Unreached(n) => write!(f, "{n} triangles are in no leaf"),
            Self::Order(entry, tri) => write!(
                f,
                "order entry {entry} names triangle {tri} again or past the mesh"
            ),
            Self::Depth(node) => write!(f, "node {node} is deeper than {MAX_DEPTH} levels"),
            Self::Bounds(node, slot) => {
                write!(
                    f,
                    "child {slot} of node {node} has a box that misses its triangles"
                )
            }
            Self::EmptySlot(node, slot) => {
                write!(f, "empty slot {slot} of node {node} has a box")
            }
            Self::OutOfMemory(bytes) => write!(f, "memory could not grow by {bytes} bytes"),
        }
    }
}

impl std::error::Error for FormatError {}

/// The bytes [`write`] gives for a tree.
pub fn stored_bytes(bvh: &MeshBvh) -> usize {
    HEADER_BYTES + bvh.nodes.len() * NODE_BYTES + bvh.order.len() * 4
}

/// Appends the stored form of a tree to `out`.
pub fn write(bvh: &MeshBvh, out: &mut Vec<u8>) {
    out.reserve(stored_bytes(bvh));
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    let words = [
        bvh.order.len() as u32,
        bvh.nodes.len() as u32,
        super::mesh::LEAF_TRIANGLES,
        0,
    ];
    for w in words {
        out.extend_from_slice(&w.to_le_bytes());
    }
    for v in bvh.bounds.min.iter().chain(&bvh.bounds.max) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for node in &bvh.nodes {
        for v in node.min.iter().chain(&node.max).flatten() {
            out.extend_from_slice(&v.to_le_bytes());
        }
        for w in node.children {
            out.extend_from_slice(&w.to_le_bytes());
        }
    }
    for &tri in &bvh.order {
        out.extend_from_slice(&tri.to_le_bytes());
    }
}

/// Reads a stored tree for `mesh`, checking it as the module documentation lists.
///
/// # Errors
/// The first check that fails, as a [`FormatError`].
pub fn read(bytes: &[u8], mesh: &impl Triangles) -> Result<MeshBvh, FormatError> {
    if bytes.len() < HEADER_BYTES || bytes[..4] != MAGIC {
        return Err(FormatError::Magic);
    }
    let u16_at = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let u32_at = |at: usize| u32::from_le_bytes(std::array::from_fn(|i| bytes[at + i]));
    let f32_at = |at: usize| f32::from_bits(u32_at(at));
    let (version, flags) = (u16_at(4), u16_at(6));
    if version != VERSION || flags != 0 {
        return Err(FormatError::Version(version, flags));
    }
    let (triangles, node_count, leaf, reserved) = (u32_at(8), u32_at(12), u32_at(16), u32_at(20));
    if reserved != 0 {
        return Err(FormatError::Version(version, flags));
    }
    let expected =
        HEADER_BYTES as u64 + u64::from(node_count) * NODE_BYTES as u64 + u64::from(triangles) * 4;
    if bytes.len() as u64 != expected {
        return Err(FormatError::Size(
            bytes.len(),
            usize::try_from(expected).unwrap_or(usize::MAX),
        ));
    }
    if triangles != mesh.count() {
        return Err(FormatError::TriangleCount(triangles, mesh.count()));
    }
    if !(1..=child::MAX_LEAF_COUNT).contains(&leaf) {
        return Err(FormatError::LeafSize(leaf));
    }
    let (n, t) = (node_count as usize, triangles as usize);
    let mut nodes = Vec::new();
    nodes
        .try_reserve_exact(n)
        .map_err(|_| FormatError::OutOfMemory(n * NODE_BYTES))?;
    for i in 0..n {
        let at = HEADER_BYTES + i * NODE_BYTES;
        let lanes = |field: usize| std::array::from_fn(|lane| f32_at(at + field * 16 + lane * 4));
        nodes.push(Node {
            min: [lanes(0), lanes(1), lanes(2)],
            max: [lanes(3), lanes(4), lanes(5)],
            children: std::array::from_fn(|c| u32_at(at + 96 + c * 4)),
        });
    }
    let order_at = HEADER_BYTES + n * NODE_BYTES;
    let mut order = Vec::new();
    order
        .try_reserve_exact(t)
        .map_err(|_| FormatError::OutOfMemory(t * 4))?;
    order.extend((0..t).map(|i| u32_at(order_at + i * 4)));
    let bounds = Aabb {
        min: [f32_at(24), f32_at(28), f32_at(32)],
        max: [f32_at(36), f32_at(40), f32_at(44)],
    };
    let bvh = MeshBvh {
        nodes,
        order,
        bounds,
    };
    check(&bvh, leaf, mesh)?;
    Ok(bvh)
}

/// The structural and bounds checks of [`read`].
fn check(bvh: &MeshBvh, max_leaf: u32, mesh: &impl Triangles) -> Result<(), FormatError> {
    let (n, t) = (bvh.nodes.len(), bvh.order.len());
    if n == 0 {
        // Only a mesh with no triangles has no nodes.
        return if t == 0 {
            Ok(())
        } else {
            Err(FormatError::Unreached(t as u32))
        };
    }
    let oom = |bytes: usize| FormatError::OutOfMemory(bytes);
    // The depth of each node, and 0 for a node no parent named yet; the root has depth 1.
    let mut depth: Vec<u8> = Vec::new();
    depth.try_reserve_exact(n).map_err(|_| oom(n))?;
    depth.resize(n, 0);
    depth[0] = 1;
    let mut covered = crate::bitset::Bitset::try_new(t as u32).map_err(|_| oom(t / 8))?;
    let mut leaves = 0u64;
    for (i, node) in bvh.nodes.iter().enumerate() {
        if depth[i] == 0 {
            return Err(FormatError::Child(i as u32, child::EMPTY));
        }
        for &w in &node.children {
            if child::is_node(w) {
                let c = w as usize;
                if c <= i || c >= n || depth[c] != 0 {
                    return Err(FormatError::Child(i as u32, w));
                }
                if depth[i] as usize >= MAX_DEPTH {
                    return Err(FormatError::Depth(c as u32));
                }
                depth[c] = depth[i] + 1;
            } else if child::is_leaf(w) {
                let (first, count) = child::leaf_range(w);
                if count > max_leaf || (first + count) as usize > t {
                    return Err(FormatError::Leaf(i as u32, w));
                }
                for e in first..first + count {
                    if covered.get(e) {
                        return Err(FormatError::Leaf(i as u32, w));
                    }
                    covered.set(e);
                }
                leaves += u64::from(count);
            }
        }
    }
    if leaves != t as u64 {
        return Err(FormatError::Unreached((t as u64 - leaves) as u32));
    }
    let mut named = crate::bitset::Bitset::try_new(t as u32).map_err(|_| oom(t / 8))?;
    for (e, &tri) in bvh.order.iter().enumerate() {
        if tri as usize >= t || named.get(tri) {
            return Err(FormatError::Order(e as u32, tri));
        }
        named.set(tri);
    }
    // Bounds: each node's exact box, from the last node back, must lie inside the box its parent
    // stores for it.
    let mut exact: Vec<Aabb> = Vec::new();
    exact
        .try_reserve_exact(n)
        .map_err(|_| oom(n * size_of::<Aabb>()))?;
    exact.resize(n, Aabb::EMPTY);
    for i in (0..n).rev() {
        let node = &bvh.nodes[i];
        let mut all = Aabb::EMPTY;
        for (slot, &w) in node.children.iter().enumerate() {
            let stored = node.child_box(slot);
            let b = if child::is_node(w) {
                exact[w as usize]
            } else if child::is_leaf(w) {
                let (first, count) = child::leaf_range(w);
                let mut b = Aabb::EMPTY;
                for &tri in &bvh.order[first as usize..(first + count) as usize] {
                    b.grow(&Aabb::of_triangle(&mesh.triangle(tri)));
                }
                b
            } else {
                // The walks test all four slots at once, so an empty slot must hold the box
                // that no test enters, bit for bit.
                if !same_bits(&stored, &Aabb::EMPTY) {
                    return Err(FormatError::EmptySlot(i as u32, slot as u32));
                }
                continue;
            };
            if !finite(&stored) || !stored.contains(&b) {
                return Err(FormatError::Bounds(i as u32, slot as u32));
            }
            all.grow(&b);
        }
        exact[i] = all;
    }
    if !finite(&bvh.bounds) || !bvh.bounds.contains(&exact[0]) {
        return Err(FormatError::Bounds(0, 4));
    }
    Ok(())
}

/// True when every corner of a box is a finite number.
fn finite(b: &Aabb) -> bool {
    b.min.iter().chain(&b.max).all(|v| v.is_finite())
}

/// True when two boxes hold the same bits, so NaN differs from everything.
fn same_bits(a: &Aabb, b: &Aabb) -> bool {
    a.min
        .iter()
        .chain(&a.max)
        .zip(b.min.iter().chain(&b.max))
        .all(|(x, y)| x.to_bits() == y.to_bits())
}

impl MeshBvh {
    /// The stored form of the tree (see [`super::format`]).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        write(self, &mut out);
        out
    }

    /// Reads a stored tree for `mesh` (see [`super::format::read`]).
    ///
    /// # Errors
    /// When the bytes fail a check.
    pub fn from_bytes(bytes: &[u8], mesh: &impl Triangles) -> Result<MeshBvh, FormatError> {
        read(bytes, mesh)
    }
}
