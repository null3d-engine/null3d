import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment } from '@react-three/drei';
function Model() { const { scene } = useGLTF('/shoe.glb'); useFrame((s, dt) => { scene.rotation.y += dt; }); return <primitive object={scene} />; }
export default function Viewer() { return (<Canvas><Environment preset="studio" /><Model /><OrbitControls /></Canvas>); }
