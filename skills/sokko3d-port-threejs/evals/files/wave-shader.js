// A three.js ShaderMaterial used by eval 3.
import * as THREE from 'three';

export const waveMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x2288ff) },
    uAmplitude: { value: 0.25 },
  },
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uAmplitude;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying float vHeight;
    void main() {
      vec3 p = position;
      p.y += sin(p.x * 2.0 + uTime) * uAmplitude;
      vHeight = p.y;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying float vHeight;
    void main() {
      float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
      vec3 c = uColor * (0.6 + vHeight) + fresnel * 0.5;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
// in the animation loop: waveMaterial.uniforms.uTime.value = clock.getElapsedTime();
