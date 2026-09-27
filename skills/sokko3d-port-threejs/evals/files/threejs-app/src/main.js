import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import GUI from 'lil-gui';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x202020, 10, 60);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 5, 12);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x444444, 1));

const draco = new DRACOLoader(); draco.setDecoderPath('/draco/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
loader.load('/models/ship.glb', (gltf) => {
  gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[0]).play();
});

const count = 10000;
const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 }), count);
scene.add(rocks);
const dummy = new THREE.Object3D();

const water = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime; varying vec2 vUv; void main() { gl_FragColor = vec4(vUv, sin(uTime), 1.0); }`,
  transparent: true,
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(50, 50), water));

const labels = new CSS2DRenderer();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
window.addEventListener('pointermove', (e) => { pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = -(e.clientY / innerHeight) * 2 + 1; });

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.2, 0.4, 0.85));

const gui = new GUI();
const clock = new THREE.Clock();
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  water.uniforms.uTime.value = t;
  for (let i = 0; i < count; i++) {
    dummy.position.set(Math.sin(i + t), i * 0.01, Math.cos(i + t));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children);
  const tmp = new THREE.Vector3();
  controls.update();
  composer.render();
}
animate();
