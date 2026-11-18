// Reyes, the player character: a third-person walker with a sprint, a camera-relative
// WASD gait, and a hitscan pistol with magazines and a reload. Movement and shooting
// live here; the camera itself is driven by main.js so the screenshot scenes can
// place it freely.

import * as THREE from 'three';
import { PLAYER } from './config.js';
import { collideCircle } from './city.js';
import { buildPersonMesh } from './people.js';

/** Ray vs AABB slab test; returns entry distance or Infinity. */
function rayBox(origin, dir, c) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [origin.x, dir.x, c.minX, c.maxX],
    [origin.z, dir.z, c.minZ, c.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  // building height: treat every collider as 40 m tall for shots from street level
  if (origin.y + dir.y * tmin > 42) return Infinity;
  return tmin;
}

/** Ray vs sphere; returns distance or Infinity. */
function raySphere(origin, dir, cx, cy, cz, r) {
  const ox = cx - origin.x;
  const oy = cy - origin.y;
  const oz = cz - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0) return Infinity;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}

export class Player {
  constructor(scene, rng) {
    this.mesh = buildPersonMesh(rng);
    // Reyes wears a teal jacket — recolour the torso so the player reads at a glance
    this.mesh.children[2].material = new THREE.MeshLambertMaterial({ color: 0x1f8a8a });
    this.gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.14, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x191b20 }),
    );
    this.gun.position.set(0.36, 1.18, 0.3);
    this.mesh.add(this.gun);
    this.flash = new THREE.PointLight(0xffc46b, 0, 9);
    this.flash.position.set(0.36, 1.2, 0.9);
    this.mesh.add(this.flash);
    scene.add(this.mesh);
    this.x = -104;
    this.z = 214;
    this.heading = Math.PI; // facing the city (north, -z is up-screen at start)
    this.vx = 0;
    this.vz = 0;
    this.health = PLAYER.maxHealth;
    this.walkPhase = 0;
    this.mag = 12;
    this.reserve = 60;
    this.reloadUntil = 0;
    this.lastShot = -9;
    this.flashTime = 0;
  }

  /** Place the player (respawns, save loads, screenshot scenes). */
  place(x, z, heading) {
    this.x = x;
    this.z = z;
    if (heading !== undefined) this.heading = heading;
    this.vx = 0;
    this.vz = 0;
    this.syncMesh(0);
  }

  /** Damage from collisions and police contact; returns true when health hits 0. */
  hurt(amount) {
    this.health = Math.max(0, this.health - amount);
    return this.health <= 0;
  }

  healFull() {
    this.health = PLAYER.maxHealth;
  }

  /**
   * One on-foot step. camYaw is the camera's orbit angle; movement is relative to it.
   * Returns the speed the player is actually moving at.
   */
  updateOnFoot(dt, input, camYaw, colliders) {
    let mx = 0;
    let mz = 0;
    if (input.down('KeyW', 'ArrowUp')) mz += 1;
    if (input.down('KeyS', 'ArrowDown')) mz -= 1;
    if (input.down('KeyA', 'ArrowLeft')) mx -= 1;
    if (input.down('KeyD', 'ArrowRight')) mx += 1;
    const sprint = input.down('ShiftLeft', 'ShiftRight');
    const speed = sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    let tx = 0;
    let tz = 0;
    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      const lx = mx / len;
      const lz = mz / len;
      // camera yaw: forward on the ground is (sin(camYaw), cos(camYaw)) rotated by input
      const fx = Math.sin(camYaw);
      const fz = Math.cos(camYaw);
      const rx = Math.cos(camYaw);
      const rz = -Math.sin(camYaw);
      tx = (fx * lz + rx * lx) * speed;
      tz = (fz * lz + rz * lx) * speed;
      const targetHeading = Math.atan2(tx, tz);
      let diff = targetHeading - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 12);
    }
    const accel = 14;
    this.vx += Math.max(-accel * dt, Math.min(accel * dt, tx - this.vx));
    this.vz += Math.max(-accel * dt, Math.min(accel * dt, tz - this.vz));
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const res = collideCircle(colliders, this.x, this.z, PLAYER.radius);
    this.x = res.x;
    this.z = res.z;
    this.x = Math.max(-272, Math.min(272, this.x));
    this.z = Math.max(-272, Math.min(264, this.z));
    const moving = Math.hypot(this.vx, this.vz);
    this.walkPhase += dt * (2.4 + moving * 1.5);
    this.syncMesh(moving);
    return moving;
  }

  /** Put the mesh where the body is, swinging the limbs with the walk cycle. */
  syncMesh(moving) {
    const ud = this.mesh.userData;
    const swing = moving > 0.3 ? Math.sin(this.walkPhase) * 0.55 : 0;
    ud.legL.rotation.x = swing;
    ud.legR.rotation.x = -swing;
    ud.armL.rotation.x = -swing * 0.8;
    // the right arm holds the pistol up when the player is aiming (always, on foot)
    ud.armR.rotation.x = -1.25;
    this.mesh.position.set(this.x, this.mesh.position.y, this.z);
    this.mesh.rotation.y = this.heading;
  }

  /** Ground height under the player: sidewalks are 0.22, roads and sand ~0. */
  groundY(isOnSidewalk) {
    return isOnSidewalk ? 0.22 : 0.02;
  }

  /** Start a reload if the magazine is not full and reserve ammo remains. */
  startReload(now) {
    if (this.mag >= 12 || this.reserve <= 0 || now < this.reloadUntil) return false;
    this.reloadUntil = now + 1.1;
    return true;
  }

  /** Finish a reload whose time has come. */
  updateGun(now) {
    if (this.reloadUntil && now >= this.reloadUntil) {
      const take = Math.min(12 - this.mag, this.reserve);
      this.mag += take;
      this.reserve -= take;
      this.reloadUntil = 0;
    }
    if (this.flashTime > 0) {
      this.flashTime -= 1 / 60;
      this.flash.intensity = Math.max(0, this.flashTime * 60);
    }
  }

  /**
   * Fire the pistol along the camera's centre ray. world: {colliders, cars, peds}.
   * Returns {kind: 'ped'|'car'|'building'|'none', point, target} for the nearest hit.
   */
  shoot(now, origin, dir, world) {
    if (now < this.reloadUntil || now - this.lastShot < 0.21) return null;
    if (this.mag <= 0) return { kind: 'empty', point: null, target: null };
    this.mag -= 1;
    this.lastShot = now;
    this.flashTime = 0.09;
    this.flash.intensity = 5;
    let best = 95;
    let hit = { kind: 'none', point: null, target: null };
    const test = (dist, kind, target) => {
      if (dist < best && dist > 0) {
        best = dist;
        hit = {
          kind,
          target,
          point: {
            x: origin.x + dir.x * dist,
            y: origin.y + dir.y * dist,
            z: origin.z + dir.z * dist,
          },
        };
      }
    };
    for (const c of world.colliders) test(rayBox(origin, dir, c), 'building', null);
    for (const car of world.cars) {
      if (car.dead) continue;
      test(raySphere(origin, dir, car.x, 0.9, car.z, 2.3), 'car', car);
      test(raySphere(origin, dir, car.x + Math.sin(car.heading) * 1.4, 0.9, car.z + Math.cos(car.heading) * 1.4, 1.6), 'car', car);
    }
    for (const ped of world.peds) {
      if (ped.state === 'down' || ped.state === 'incar') continue;
      test(raySphere(origin, dir, ped.x, 1.05, ped.z, 0.85), 'ped', ped);
    }
    if (hit.kind === 'none') {
      hit.point = { x: origin.x + dir.x * 60, y: origin.y + dir.y * 60, z: origin.z + dir.z * 60 };
    }
    return hit;
  }
}
