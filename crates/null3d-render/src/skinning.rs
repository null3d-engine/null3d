//! Skinning that both frame builders share: each skinned object's bounding sphere from its pose,
//! the texture of joint matrices that the GPU reads, the vertex format of vertices that the
//! WebGPU builder's compute pass skins, and the pipelines of objects that the WebGL2 builder skins
//! in their vertex shaders.
//!
//! # Skinned objects
//!
//! A scene object is skinned while an animated instance skins it (`SceneStorage::skins`) and its
//! mesh has joints and weights. Its vertices sit in the space of the instance's skeleton: each
//! skinned vertex is the weighted sum of its four joints' skinning matrices applied to it, and the
//! object's world matrix then places it, as three.js draws a `SkinnedMesh` whose bind matrix is
//! the identity.
//!
//! # Bounds
//!
//! A skinned or morphed object culls with a sphere of its own, which [`update_bounds`] writes
//! before each transform update. Each joint of the mesh has a sphere around the vertices that it
//! moves (see [`crate::meshes::joint_spheres`]). A skinned vertex is a weighted average of its
//! joints' matrices applied to it, and each matrix keeps the vertex inside its joint's moved
//! sphere, so a sphere around every moved joint sphere holds the whole pose, whatever limbs swing
//! out. It costs one matrix product per joint, not per vertex. Morph targets move each vertex
//! before it is skinned by at most their reach times their weights (see [`crate::morph::reach`]),
//! so each joint sphere grows by that much first.
//!
//! # The joint texture
//!
//! Every instance's skinning matrices reach the GPU in one RGBA32F texture: [`JOINTS_PER_ROW`]
//! joints per row, three texels per joint, one per row of its 3 × 4 matrix. A joint's place in the
//! animation table's matrix buffer gives its texel, so each frame uploads the rows that hold joints
//! in use straight from the buffer that the frame's animation step wrote. Shaders that skin read
//! it with `textureLoad`, which WebGL2's vertex shaders can do too.

use null3d_core::animation::Animations;
use null3d_core::math::max_axis_scale;
use null3d_core::morph::{MAX_TARGETS, MorphWeights};
use null3d_core::scene::SceneStorage;
use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::drawlist::{DrawList, Op, format, permutation, texture_usage, vertex, view};

use crate::frame::{RecordError, address, floats_as_bytes};
use crate::meshes::{MeshSlot, MeshStorage};
use crate::morph::{morph_of, posed_weights, reach};
use crate::pipelines::DrawKey;

/// Joints per row of the joint texture.
pub const JOINTS_PER_ROW: u32 = 1024;
/// Texels per joint: one per row of its 3 × 4 matrix.
pub const TEXELS_PER_JOINT: u32 = 3;
/// Bytes of one row of the joint texture: a row of joints' matrices, as the matrix buffer holds
/// them.
const ROW_BYTES: u32 = JOINTS_PER_ROW * MATRIX_FLOATS as u32 * 4;

/// The vertex location of a skinned mesh's joints.
const JOINTS_LOCATION: usize = 6;
/// The vertex location of a skinned mesh's weights.
const WEIGHTS_LOCATION: usize = 7;

/// True for a mesh whose vertices name joints and weights, which an animated instance can skin.
pub fn has_joints(format: u32) -> bool {
    format & (vertex::JOINTS | vertex::WEIGHTS) == vertex::JOINTS | vertex::WEIGHTS
}

/// The first joint in the matrix buffer and the joint count of the animated instance that skins
/// scene slot `slot`, or `None` for an object that no live instance skins, whose mesh has no
/// joints, or whose mesh names joints that the instance's skeleton lacks. Such an object draws its
/// mesh as it is.
pub fn skin_of(
    scene: &SceneStorage,
    animations: Option<&Animations>,
    meshes: &MeshStorage,
    slot: usize,
) -> Option<(u32, u32)> {
    let skin = *scene.skins().get(slot)?;
    if skin == 0 {
        return None;
    }
    let mesh = meshes.mesh(scene.meshes()[slot].checked_sub(1)?)?;
    if !has_joints(mesh.format) {
        return None;
    }
    animations?
        .instance_joints(skin - 1)
        .filter(|&(_, joints)| mesh.joints <= joints)
}

/// The vertex format of a skinned or morphed mesh's vertices once a compute pass has skinned and
/// morphed them: the mesh's format without its joints, weights and morph attribute, with
/// positions, normals and tangents as 32-bit floats. The other attributes keep their types, as the
/// pass copies them unchanged.
pub fn skinned_format(format: u32) -> u32 {
    let mut types = 0;
    for location in [
        vertex::POSITION,
        vertex::NORMAL,
        4,
        JOINTS_LOCATION,
        WEIGHTS_LOCATION,
    ] {
        types |= vertex::ATTRIBUTES[location].mask();
    }
    format & !(vertex::JOINTS | vertex::WEIGHTS | vertex::MORPH | types)
}

/// The pipeline that skins an object in its vertex shader, as WebGL2 draws skinned objects
/// (decision record D-10): the [`permutation::SKIN`] variant of the object's own pipeline, which
/// reads the mesh's joints and weights.
pub fn skinned_in_vertex_shader(key: DrawKey) -> DrawKey {
    DrawKey {
        permutation: key.permutation | permutation::SKIN,
        ..key
    }
}

/// Writes the bounding sphere of every skinned or morphed object, in the object's space, for the
/// transform update that follows (see the module documentation): from its pose in the animation
/// table's last step, grown by how far its morph weights move its vertices. Joints past the
/// instance's skeleton are left out. A sphere that did not change leaves the object as it is. It
/// allocates nothing.
pub fn update_bounds(
    scene: &mut SceneStorage,
    animations: Option<&Animations>,
    morphs: &MorphWeights,
    meshes: &MeshStorage,
) {
    // Without clips or morph weights, no object is posed.
    if animations.is_none() && morphs.values().is_empty() {
        return;
    }
    let mut weights = [0.0f32; MAX_TARGETS as usize];
    for slot in 0..scene.skins().len() {
        let (skin, morph) = (scene.skins()[slot], scene.morphs()[slot]);
        if skin == 0 && morph == 0 {
            continue;
        }
        let Some(mesh) = scene.meshes()[slot]
            .checked_sub(1)
            .and_then(|mesh| meshes.mesh(mesh))
        else {
            continue;
        };
        let extra = morph_of(scene, morphs, meshes, slot).map_or(0.0, |block| {
            let weights = &mut weights[..block.count as usize];
            posed_weights(block, morphs, animations, weights);
            reach(meshes, mesh, weights)
        });
        let pose = animations
            .zip(skin.checked_sub(1))
            .and_then(|(animations, instance)| {
                let (first, joints) = animations.instance_joints(instance)?;
                let matrices = animations.matrices();
                Some(&matrices[first as usize * MATRIX_FLOATS..][..joints as usize * MATRIX_FLOATS])
            });
        let sphere = match pose.and_then(|pose| posed_sphere(meshes, mesh, pose, extra)) {
            Some(sphere) => sphere,
            None if morph != 0 => ([0.0; 3], mesh.radius + extra),
            None => continue,
        };
        let s = slot;
        let same = scene.local_radii()[s] == sphere.1
            && scene.local_centers()[s * 3..s * 3 + 3] == sphere.0;
        if !same {
            scene.set_local_sphere(slot as u32, sphere.0, sphere.1);
        }
    }
}

/// The sphere around a mesh's joint spheres, each grown by `extra`, moved by the skinning matrices
/// of `pose`, or `None` for a mesh whose joints move no vertex.
fn posed_sphere(
    meshes: &MeshStorage,
    mesh: &MeshSlot,
    pose: &[f32],
    extra: f32,
) -> Option<([f32; 3], f32)> {
    let moved = |(joint, sphere): (usize, &[f32; 4])| {
        let m: &[f32; MATRIX_FLOATS] = pose
            .get(joint * MATRIX_FLOATS..(joint + 1) * MATRIX_FLOATS)?
            .try_into()
            .ok()?;
        if sphere[3] < 0.0 {
            return None;
        }
        let c = [0, 1, 2].map(|row| {
            let r = &m[row * 4..row * 4 + 4];
            r[0] * sphere[0] + r[1] * sphere[1] + r[2] * sphere[2] + r[3]
        });
        Some((c, (sphere[3] + extra) * max_axis_scale(m)))
    };
    let spheres = meshes.joint_spheres(mesh);
    let (mut low, mut high) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
    for (c, r) in spheres.iter().enumerate().filter_map(moved) {
        for k in 0..3 {
            low[k] = low[k].min(c[k] - r);
            high[k] = high[k].max(c[k] + r);
        }
    }
    if low[0] > high[0] {
        return None;
    }
    let center = [0, 1, 2].map(|k| 0.5 * (low[k] + high[k]));
    let radius = spheres
        .iter()
        .enumerate()
        .filter_map(moved)
        .map(|(c, r)| {
            let d = [0, 1, 2].map(|k| c[k] - center[k]);
            (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() + r
        })
        .fold(0.0f32, f32::max);
    Some((center, radius))
}

/// The texture of every instance's skinning matrices on the GPU (see the module documentation),
/// made the first time a frame draws a skinned object.
#[derive(Debug)]
pub(crate) struct JointTexture {
    /// The texture's id among the builder's textures.
    id: u32,
    /// Its rows, 0 before it exists.
    rows: u32,
}

impl JointTexture {
    pub(crate) fn new(id: u32) -> Self {
        Self { id, rows: 0 }
    }

    /// The texture's id.
    pub(crate) fn id(&self) -> u32 {
        self.id
    }

    /// True once the texture exists.
    pub(crate) fn exists(&self) -> bool {
        self.rows > 0
    }

    /// Records the texture's creation when it does not exist yet, with a row for every
    /// [`JOINTS_PER_ROW`] joints that the animation table can hold, or one row before the scene
    /// has an animation table, for the bind groups of morphed objects that no joint skins.
    /// Returns true when it made the texture, which bind groups that read it must see.
    pub(crate) fn create(
        &mut self,
        list: &mut DrawList,
        animations: Option<&Animations>,
    ) -> Result<bool, RecordError> {
        let rows = animations.map_or(1, |a| a.joint_capacity().div_ceil(JOINTS_PER_ROW).max(1));
        if self.rows >= rows {
            return Ok(false);
        }
        self.rows = rows;
        list.push(
            Op::CreateTexture,
            &[
                self.id,
                JOINTS_PER_ROW * TEXELS_PER_JOINT,
                self.rows,
                1,
                format::RGBA32_FLOAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2,
            ],
        )?;
        Ok(true)
    }

    /// Uploads the joints in use, from the matrix buffer of the animation table's last step,
    /// which no later step writes while the frame's draw list waits to replay: one write of the
    /// rows they fill, and one of the part of a row that holds the rest.
    pub(crate) fn upload(
        &self,
        list: &mut DrawList,
        animations: &Animations,
    ) -> Result<(), RecordError> {
        let joints = animations.joints().min(self.rows * JOINTS_PER_ROW);
        let matrices = animations.matrices();
        let (full, rest) = (joints / JOINTS_PER_ROW, joints % JOINTS_PER_ROW);
        let mut write = |row: u32, width: u32, rows: u32| {
            let first = (row * JOINTS_PER_ROW) as usize * MATRIX_FLOATS;
            let floats = &matrices[first..first + (width * rows) as usize * MATRIX_FLOATS];
            list.push(
                Op::WriteTexture,
                &[
                    self.id,
                    0,
                    0,
                    row,
                    0,
                    width * TEXELS_PER_JOINT,
                    rows,
                    1,
                    address(floats_as_bytes(floats)),
                    width * rows * ROW_BYTES / JOINTS_PER_ROW,
                ],
            )
        };
        if full > 0 {
            write(0, JOINTS_PER_ROW, full)?;
        }
        if rest > 0 {
            write(full, rest, 1)?;
        }
        Ok(())
    }

    /// Forgets the texture, after the thread that draws replaced the GPU.
    pub(crate) fn forget_gpu(&mut self) {
        self.rows = 0;
    }
}

#[cfg(test)]
mod tests {
    use null3d_core::animation::{NO_PARENT, REST_FLOATS, Skeleton};
    use null3d_core::handle::Handle;
    use null3d_core::jobs::JobSystem;
    use null3d_core::scene::{Command, flags};

    use super::*;
    use crate::geometry::Geometry;
    use crate::meshes::{Packing, joint_spheres};

    /// A chain of `joints` joints up the y axis, one unit apart, with no turn at rest.
    fn chain(joints: u32) -> Skeleton {
        let parents: Vec<u32> = (0..joints)
            .map(|j| if j == 0 { NO_PARENT } else { j - 1 })
            .collect();
        let mut rest = vec![0.0; joints as usize * REST_FLOATS];
        let mut binds = vec![0.0; joints as usize * MATRIX_FLOATS];
        for j in 0..joints as usize {
            let r = &mut rest[j * REST_FLOATS..(j + 1) * REST_FLOATS];
            r.copy_from_slice(&[
                0.0,
                if j == 0 { 0.0 } else { 1.0 },
                0.0,
                0.0,
                0.0,
                0.0,
                1.0,
                1.0,
                1.0,
                1.0,
            ]);
            let b = &mut binds[j * MATRIX_FLOATS..(j + 1) * MATRIX_FLOATS];
            b.copy_from_slice(&[
                1.0,
                0.0,
                0.0,
                0.0,
                0.0,
                1.0,
                0.0,
                -(j as f32),
                0.0,
                0.0,
                1.0,
                0.0,
            ]);
        }
        Skeleton::new(&parents, &rest, &binds).unwrap()
    }

    /// A skinned column of `rings` rings of four vertices, one unit apart up the y axis and half a
    /// unit out, each ring moved by its own joint alone, in floats.
    fn column(rings: u32) -> Geometry {
        let format = vertex::JOINTS | vertex::WEIGHTS;
        let mut g = Geometry {
            format,
            ..Geometry::default()
        };
        for ring in 0..rings {
            for [x, z] in [[0.5, 0.0], [-0.5, 0.0], [0.0, 0.5], [0.0, -0.5]] {
                let y = ring as f32;
                for v in [x, y, z, 0.0, 1.0, 0.0] {
                    g.vertices.extend_from_slice(&f32::to_le_bytes(v));
                }
                g.vertices.extend_from_slice(&[ring as u8, 0, 0, 0]);
                for w in [1.0f32, 0.0, 0.0, 0.0] {
                    g.vertices.extend_from_slice(&w.to_le_bytes());
                }
            }
        }
        g.indices = vec![0, 1, 2];
        g
    }

    #[test]
    fn each_joint_sphere_holds_the_vertices_that_its_joint_moves() {
        let spheres = joint_spheres(&column(3));
        assert_eq!(spheres.len(), 3);
        for (j, sphere) in spheres.iter().enumerate() {
            assert_eq!(*sphere, [0.0, j as f32, 0.0, 0.5]);
        }
        let plain = Geometry::from_floats(0, &[0.0; 18], vec![0, 1, 2]);
        assert!(joint_spheres(&plain).is_empty());
    }

    #[test]
    fn the_skinned_format_drops_joints_and_weights_and_keeps_floats_for_what_moves() {
        let quantized = vertex::with(
            vertex::UV0 | vertex::JOINTS | vertex::WEIGHTS,
            0,
            vertex::Type::Sint16,
        )
        .and_then(|f| vertex::with(f, 2, vertex::Type::Unorm16))
        .and_then(|f| vertex::with(f, JOINTS_LOCATION, vertex::Type::Uint16))
        .unwrap();
        let skinned = skinned_format(quantized);
        assert_eq!(skinned & vertex::ALL, vertex::UV0);
        assert_eq!(vertex::type_of(skinned, 0), Some(vertex::Type::F32));
        assert_eq!(vertex::type_of(skinned, 2), Some(vertex::Type::Unorm16));
        assert!(has_joints(quantized) && !has_joints(skinned));
    }

    #[test]
    fn a_bent_pose_moves_the_bounds_with_the_limbs_that_swing_out() {
        let jobs = JobSystem::new(0);
        let mut meshes = MeshStorage::new(Packing::SharedBuffers);
        let mesh = meshes.add(&column(3)).unwrap();
        let mut animations = Animations::new(&jobs, 4, 64).unwrap();
        let skeleton = animations.add_skeleton(chain(3)).unwrap();
        let instance = animations.add_instance(skeleton).unwrap();
        animations.update(&jobs, 0.0);

        let mut scene = SceneStorage::with_capacity(4);
        let object = scene.reserve().unwrap();
        let create = Command::create(object, Handle::NONE, mesh + 1, flags::VISIBLE);
        let skin = Command::set_skin(object, Some(instance));
        scene.apply_commands(&[create, skin], 1).unwrap();
        let slot = scene.resolve(object).unwrap() as usize;
        assert_eq!(
            skin_of(&scene, Some(&animations), &meshes, slot),
            Some((0, 3))
        );

        // At rest the column stands from y = -0.5 to 2.5 around its middle ring.
        update_bounds(&mut scene, Some(&animations), &MorphWeights::new(), &meshes);
        assert_eq!(
            &scene.local_centers()[slot * 3..slot * 3 + 3],
            &[0.0, 1.0, 0.0]
        );
        assert_eq!(scene.local_radii()[slot], 1.5);

        // The top joint swung out to x = 10: the sphere reaches it, and holds every vertex.
        let pose = &mut [0.0f32; 3 * MATRIX_FLOATS];
        for (j, m) in pose.chunks_mut(MATRIX_FLOATS).enumerate() {
            let x = if j == 2 { 10.0 } else { 0.0 };
            m.copy_from_slice(&[1.0, 0.0, 0.0, x, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
        }
        let (center, radius) =
            posed_sphere(&meshes, meshes.mesh(mesh).unwrap(), pose, 0.0).unwrap();
        for ring in 0..3 {
            let x = if ring == 2 { 10.0 } else { 0.0 };
            for [dx, dz] in [[0.5, 0.0], [-0.5, 0.0], [0.0, 0.5], [0.0, -0.5]] {
                let d = [x + dx - center[0], ring as f32 - center[1], dz - center[2]];
                assert!((d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() <= radius + 1e-5);
            }
        }
        assert!(center[0] > 4.0);
    }

    /// A column of `rings` rings like [`column`]'s, whose vertices between two rings share their
    /// weight between the two rings' joints, as a skinned character's do.
    fn blended_column(rings: u32) -> Geometry {
        let mut g = Geometry {
            format: vertex::JOINTS | vertex::WEIGHTS,
            ..Geometry::default()
        };
        for step in 0..(rings - 1) * 4 + 1 {
            let y = step as f32 / 4.0;
            let (below, share) = ((y as u8).min(rings as u8 - 2), y.fract());
            let share = if y as u32 == rings - 1 { 1.0 } else { share };
            for [x, z] in [[0.5, 0.0], [-0.5, 0.0], [0.0, 0.5], [0.0, -0.5]] {
                for v in [x, y, z, 0.0, 1.0, 0.0] {
                    g.vertices.extend_from_slice(&f32::to_le_bytes(v));
                }
                g.vertices.extend_from_slice(&[below, below + 1, 0, 0]);
                for w in [1.0 - share, share, 0.0, 0.0] {
                    g.vertices.extend_from_slice(&w.to_le_bytes());
                }
            }
        }
        g.indices = vec![0, 1, 2];
        g
    }

    #[test]
    fn extreme_poses_keep_every_skinned_vertex_inside_the_bounds() {
        let geometry = blended_column(6);
        let mut meshes = MeshStorage::new(Packing::SharedBuffers);
        let mesh = meshes.add(&geometry).unwrap();
        let slot = *meshes.mesh(mesh).unwrap();
        // A small generator of numbers from -1 to 1, so every run tries the same poses.
        let mut state = 0x2545_f491_u32;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as f32 / u32::MAX as f32 * 2.0 - 1.0
        };
        for _ in 0..200 {
            // Each joint turns up to half a turn about a random axis, scales by 0.5 to 2 and moves
            // up to 3 m: far from any pose a clip would hold.
            let mut pose = vec![0.0f32; 6 * MATRIX_FLOATS];
            for m in pose.chunks_mut(MATRIX_FLOATS) {
                let axis = [next(), next(), next()];
                let length = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
                let [x, y, z] = axis.map(|a| a / length.max(1e-3));
                let (sin, cos) = (next() * std::f32::consts::PI).sin_cos();
                let scale = 1.25 + 0.75 * next();
                let r = [
                    [
                        cos + x * x * (1.0 - cos),
                        x * y * (1.0 - cos) - z * sin,
                        x * z * (1.0 - cos) + y * sin,
                    ],
                    [
                        y * x * (1.0 - cos) + z * sin,
                        cos + y * y * (1.0 - cos),
                        y * z * (1.0 - cos) - x * sin,
                    ],
                    [
                        z * x * (1.0 - cos) - y * sin,
                        z * y * (1.0 - cos) + x * sin,
                        cos + z * z * (1.0 - cos),
                    ],
                ];
                for row in 0..3 {
                    for col in 0..3 {
                        m[row * 4 + col] = r[row][col] * scale;
                    }
                    m[row * 4 + 3] = 3.0 * next();
                }
            }
            let (center, radius) = posed_sphere(&meshes, &slot, &pose, 0.0).unwrap();
            for v in 0..geometry.vertex_count() {
                let p = geometry.position(v);
                let joints = geometry.values(v, JOINTS_LOCATION);
                let weights = geometry.values(v, WEIGHTS_LOCATION);
                let mut skinned = [0.0f32; 3];
                for k in 0..4 {
                    let m = &pose[joints[k] as usize * MATRIX_FLOATS..][..MATRIX_FLOATS];
                    for row in 0..3 {
                        let r = &m[row * 4..row * 4 + 4];
                        skinned[row] +=
                            weights[k] * (r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3]);
                    }
                }
                let d = [0, 1, 2].map(|c| skinned[c] - center[c]);
                let distance = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
                assert!(
                    distance <= radius * (1.0 + 1e-5),
                    "{distance} past {radius}"
                );
            }
        }
    }
}
