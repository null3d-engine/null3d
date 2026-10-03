//! Skeletons: joints in parents-first order, with their rest pose and inverse bind matrices.

use super::{AnimationError, MATRIX_FLOATS, Pose, filled};
use crate::math::Affine;

/// The parent of a joint that has none, a root of the skeleton: the scene's value for an object
/// with no parent.
pub use crate::scene::NO_PARENT;

/// The most joints one skeleton has. glTF characters for games use up to a few hundred.
pub const MAX_JOINTS: u32 = 1024;

/// Floats per joint in [`Skeleton::new`]'s rest pose: translation, rotation `(x, y, z, w)` and
/// scale.
pub const REST_FLOATS: usize = 10;

/// A skeleton: each joint's parent, rest pose and inverse bind matrix. Joints are in parents-first
/// order, so composing them in index order finds each parent finished.
#[derive(Clone, Debug)]
pub struct Skeleton {
    parents: Box<[u32]>,
    rest: Pose,
    inverse_bind: Box<[Affine]>,
}

impl Skeleton {
    /// A skeleton of `parents.len()` joints. Each parent is [`NO_PARENT`] or an earlier joint.
    /// `rest` holds [`REST_FLOATS`] values per joint, and `inverse_bind` one row-major 3 × 4
    /// matrix of 12 values per joint: the inverse of the joint's matrix in the skeleton's space
    /// when the mesh was bound to it.
    pub fn new(
        parents: &[u32],
        rest: &[f32],
        inverse_bind: &[f32],
    ) -> Result<Self, AnimationError> {
        let joints = parents.len();
        if joints == 0 || joints > MAX_JOINTS as usize {
            return Err(AnimationError::Joints {
                joints: u32::try_from(joints).unwrap_or(u32::MAX),
            });
        }
        let joints_u32 = joints as u32;
        let arrays = [
            (0, rest.len(), REST_FLOATS),
            (1, inverse_bind.len(), MATRIX_FLOATS),
        ];
        for (array, len, per_joint) in arrays {
            if len != joints * per_joint {
                return Err(AnimationError::Length {
                    array,
                    expected: joints_u32 * per_joint as u32,
                });
            }
        }
        for (joint, &parent) in parents.iter().enumerate() {
            if parent != NO_PARENT && parent as usize >= joint {
                return Err(AnimationError::Parent {
                    joint: joint as u32,
                    parent,
                });
            }
        }
        if let Some(at) = rest.iter().chain(inverse_bind).position(|v| !v.is_finite()) {
            let joint = if at < rest.len() {
                at / REST_FLOATS
            } else {
                (at - rest.len()) / MATRIX_FLOATS
            };
            return Err(AnimationError::NotFinite { at: joint as u32 });
        }

        let mut pose = Pose::identity(joints_u32)?;
        for (j, v) in rest.as_chunks::<REST_FLOATS>().0.iter().enumerate() {
            pose.set_joint(
                j as u32,
                [v[0], v[1], v[2]],
                [v[3], v[4], v[5], v[6]],
                [v[7], v[8], v[9]],
            );
        }
        let mut owned_parents = filled(joints, NO_PARENT)?;
        owned_parents.copy_from_slice(parents);
        let mut binds = filled(joints, [0.0f32; MATRIX_FLOATS])?;
        binds.copy_from_slice(inverse_bind.as_chunks::<MATRIX_FLOATS>().0);
        Ok(Skeleton {
            parents: owned_parents.into_boxed_slice(),
            rest: pose,
            inverse_bind: binds.into_boxed_slice(),
        })
    }

    /// The number of joints.
    pub fn joints(&self) -> u32 {
        self.parents.len() as u32
    }

    /// The joint count rounded up to a multiple of four.
    pub fn lanes(&self) -> u32 {
        self.rest.lanes()
    }

    /// Each joint's parent, or [`NO_PARENT`].
    pub fn parents(&self) -> &[u32] {
        &self.parents
    }

    /// The rest pose, which joints keep where no clip moves them.
    pub fn rest(&self) -> &Pose {
        &self.rest
    }

    /// Each joint's inverse bind matrix.
    pub fn inverse_bind(&self) -> &[Affine] {
        &self.inverse_bind
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::IDENTITY;

    fn rest(joints: usize) -> Vec<f32> {
        [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0].repeat(joints)
    }

    #[test]
    fn builds_a_chain() {
        let skeleton = Skeleton::new(&[NO_PARENT, 0, 1], &rest(3), &IDENTITY.repeat(3)).unwrap();
        assert_eq!(skeleton.joints(), 3);
        assert_eq!(skeleton.lanes(), 4);
        assert_eq!(skeleton.parents(), &[NO_PARENT, 0, 1]);
        assert_eq!(skeleton.inverse_bind()[2], IDENTITY);
    }

    #[test]
    fn refuses_bad_input() {
        let binds = IDENTITY.repeat(2);
        assert_eq!(
            Skeleton::new(&[], &[], &[]).unwrap_err(),
            AnimationError::Joints { joints: 0 }
        );
        assert_eq!(
            Skeleton::new(&[NO_PARENT, 1], &rest(2), &binds).unwrap_err(),
            AnimationError::Parent {
                joint: 1,
                parent: 1
            }
        );
        assert_eq!(
            Skeleton::new(&[NO_PARENT, 0], &rest(1), &binds).unwrap_err(),
            AnimationError::Length {
                array: 0,
                expected: 20
            }
        );
        let mut bad = rest(2);
        bad[13] = f32::NAN;
        assert_eq!(
            Skeleton::new(&[NO_PARENT, 0], &bad, &binds).unwrap_err(),
            AnimationError::NotFinite { at: 1 }
        );
        let too_many = vec![NO_PARENT; MAX_JOINTS as usize + 1];
        assert_eq!(
            Skeleton::new(&too_many, &[], &[]).unwrap_err(),
            AnimationError::Joints {
                joints: MAX_JOINTS + 1
            }
        );
    }
}
