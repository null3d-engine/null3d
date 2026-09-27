// A deliberately slow sokko3d game file used by eval 2. Do not copy these patterns.
import { defineGame, vec3 } from '@sokko3d/engine';

export default defineGame(async ({ scene, geometry, materials, page, input }) => {
  const enemyMesh = geometry.capsule({ radius: 0.3, length: 1 });
  const enemyMat = materials.standard({ color: '#c83232' });
  const enemies = [];
  for (let i = 0; i < 5000; i++) {
    const e = scene.createMesh({ mesh: enemyMesh, material: enemyMat, dynamic: true });
    e.setPosition(Math.random() * 200 - 100, 0, Math.random() * 200 - 100);
    enemies.push({ obj: e, pos: [0, 0, 0], speed: 1 + Math.random() });
  }
  const bullets = [];
  const player = [0, 0, 0];

  return {
    onUpdate(dt) {
      for (const e of enemies) {
        e.obj.getPosition(e.pos);
        const toPlayer = vec3.sub(vec3.create(), player, e.pos);   // allocates every call
        vec3.normalize(toPlayer, toPlayer);
        e.obj.setPosition(e.pos[0] + toPlayer[0] * e.speed * dt, 0, e.pos[2] + toPlayer[2] * e.speed * dt);
      }
      if (input.isDown('Space')) {
        const b = scene.createMesh({ mesh: geometry.sphere({ radius: 0.1 }), material: materials.unlit({ color: '#ffff00' }), dynamic: true });
        b.setPosition(player[0], 1, player[2]);
        bullets.push({ obj: b, life: 2 });
      }
      for (const b of bullets.filter((x) => x.life > 0)) {
        b.life -= dt;
        b.obj.translate(0, 0, -20 * dt);
        if (b.life <= 0) b.obj.destroy();
      }
      page.post('enemy-positions', enemies.map((e) => e.pos));   // every frame
    },
  };
});
