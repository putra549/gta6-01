// Pedestrians: low-poly Marlowe Bay residents who stroll the sidewalk rings around
// each block, chat in pairs, flee from speeding cars and gunfire, and go down when a
// car hits them (which the wanted system hears about). One Crowd owns every walker;
// missions can also claim a scripted pedestrian (the nervous passenger) from it.

import * as THREE from 'three';
import { collideCircle } from './city.js';
import { pick, randRange } from './rng.js';

const skinTones = [0xf2c89b, 0xd9a066, 0xa0663a, 0x6e4525, 0xffe0bd];
const shirtColors = [0xd94f3d, 0x3d7dd9, 0x3dd97d, 0xd9c53d, 0x9b3dd9, 0x3dd9d9, 0xf2f2f2, 0x333a44, 0xff8fb3];
const pantsColors = [0x2c3550, 0x50452c, 0x22242a, 0x6e7a8a, 0x7a2c3a];

const legGeo = new THREE.BoxGeometry(0.16, 0.78, 0.18);
const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.28);
const armGeo = new THREE.BoxGeometry(0.13, 0.66, 0.15);
const headGeo = new THREE.SphereGeometry(0.21, 8, 7);

/** Build one pedestrian mesh; userData carries the swinging limbs. */
export function buildPersonMesh(rng) {
  const group = new THREE.Group();
  const pants = new THREE.MeshLambertMaterial({ color: pick(rng, pantsColors) });
  const shirt = new THREE.MeshLambertMaterial({ color: pick(rng, shirtColors) });
  const skin = new THREE.MeshLambertMaterial({ color: pick(rng, skinTones) });
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.14, 0.39, 0);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.14, 0.39, 0);
  // pivot the legs at the hip so they swing
  legL.geometry = legGeo;
  const torso = new THREE.Mesh(torsoGeo, shirt);
  torso.position.y = 1.14;
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.34, 1.16, 0);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.position.set(0.34, 1.16, 0);
  const head = new THREE.Mesh(headGeo, skin);
  head.position.y = 1.72;
  group.add(legL, legR, torso, armL, armR, head);
  group.userData = { legL, legR, armL, armR };
  return group;
}

/** Point on a sidewalk ring's perimeter at arc-length parameter s (metres). */
function ringPoint(ring, s) {
  const h = ring.half;
  const side = 2 * h;
  const total = side * 4;
  let d = ((s % total) + total) % total;
  if (d < side) return { x: ring.cx - h + d, z: ring.cz - h, dir: [1, 0] };
  d -= side;
  if (d < side) return { x: ring.cx + h, z: ring.cz - h + d, dir: [0, 1] };
  d -= side;
  if (d < side) return { x: ring.cx + h - d, z: ring.cz + h, dir: [-1, 0] };
  d -= side;
  return { x: ring.cx - h, z: ring.cz + h - d, dir: [0, -1] };
}

/** The crowd of walkers, plus any scripted pedestrians missions spawn. */
export class Crowd {
  constructor(scene, rings, rng) {
    this.scene = scene;
    this.rings = rings;
    this.rng = rng;
    this.peds = [];
    const count = 26;
    for (let i = 0; i < count; i += 1) {
      const ring = pick(rng, rings);
      this._spawn(ring, randRange(rng, 0, ring.half * 8));
    }
  }

  _spawn(ring, s) {
    const mesh = buildPersonMesh(this.rng);
    const ped = {
      mesh,
      ring,
      s,
      dirSign: this.rng() < 0.5 ? 1 : -1,
      speed: randRange(this.rng, 1.1, 1.7),
      x: 0,
      z: 0,
      heading: 0,
      state: 'walk', // walk | flee | down | idle | follow | incar
      panic: 0,
      fleeX: 0,
      fleeZ: 0,
      downTime: 0,
      walkPhase: randRange(this.rng, 0, 6),
      targetX: 0,
      targetZ: 0,
      scripted: false,
    };
    const p = ringPoint(ring, s);
    ped.x = p.x;
    ped.z = p.z;
    mesh.position.set(p.x, 0.22, p.z);
    this.scene.add(mesh);
    this.peds.push(ped);
    return ped;
  }

  /** A pedestrian under mission control (the passenger): stands at (x, z) until told to move. */
  addScripted(x, z) {
    const mesh = buildPersonMesh(this.rng);
    const ped = {
      mesh,
      ring: null,
      s: 0,
      dirSign: 1,
      speed: 3.4,
      x,
      z,
      heading: 0,
      state: 'idle',
      panic: 0,
      fleeX: 0,
      fleeZ: 0,
      downTime: 0,
      walkPhase: 0,
      targetX: x,
      targetZ: z,
      scripted: true,
    };
    mesh.position.set(x, 0.22, z);
    this.scene.add(mesh);
    this.peds.push(ped);
    return ped;
  }

  remove(ped) {
    this.scene.remove(ped.mesh);
    this.peds.splice(this.peds.indexOf(ped), 1);
  }

  /** Make every walker within radius of (x, z) run from it. */
  scare(x, z, radius) {
    for (const ped of this.peds) {
      if (ped.state !== 'walk' && ped.state !== 'idle') continue;
      const d = Math.hypot(ped.x - x, ped.z - z);
      if (d < radius) {
        ped.state = 'flee';
        ped.panic = randRange(this.rng, 2.2, 4);
        ped.fleeX = ped.x + ((ped.x - x) / (d + 0.01)) * 14;
        ped.fleeZ = ped.z + ((ped.z - z) / (d + 0.01)) * 14;
      }
    }
  }

  /** True when a walking witness is within radius of a crime at (x, z). */
  witnessNear(x, z, radius) {
    for (const ped of this.peds) {
      if (ped.state === 'down' || ped.state === 'incar') continue;
      if (Math.hypot(ped.x - x, ped.z - z) < radius) return true;
    }
    return false;
  }

  /**
   * Advance the crowd. ctx: {cars, colliders, time, onPedHit(ped, car)} — a hit is
   * reported once, as the pedestrian goes down.
   */
  update(dt, ctx) {
    const { cars, colliders, time } = ctx;
    for (const ped of this.peds) {
      if (ped.state === 'incar') {
        ped.mesh.visible = false;
        continue;
      }
      ped.mesh.visible = true;
      let moving = 0;
      if (ped.state === 'down') {
        ped.downTime -= dt;
        ped.mesh.rotation.x = -Math.PI / 2;
        ped.mesh.position.y = 0.35;
        if (ped.downTime <= 0) {
          ped.mesh.rotation.x = 0;
          ped.state = 'flee';
          ped.panic = 2.5;
          ped.fleeX = ped.x + randRange(this.rng, -12, 12);
          ped.fleeZ = ped.z + randRange(this.rng, -12, 12);
        }
        continue;
      }
      if (ped.state === 'flee') {
        ped.panic -= dt;
        const dx = ped.fleeX - ped.x;
        const dz = ped.fleeZ - ped.z;
        const d = Math.hypot(dx, dz);
        if (ped.panic <= 0 || d < 0.6) {
          ped.state = ped.scripted ? 'idle' : 'walk';
          if (!ped.scripted) this._rejoinRing(ped);
        } else {
          ped.heading = Math.atan2(dx, dz);
          const step = Math.min(d, 4.3 * dt);
          ped.x += Math.sin(ped.heading) * step;
          ped.z += Math.cos(ped.heading) * step;
          moving = 1.8;
        }
      } else if (ped.state === 'follow') {
        const dx = ped.targetX - ped.x;
        const dz = ped.targetZ - ped.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.7) {
          ped.state = 'idle';
        } else {
          ped.heading = Math.atan2(dx, dz);
          const step = Math.min(d, ped.speed * dt);
          ped.x += Math.sin(ped.heading) * step;
          ped.z += Math.cos(ped.heading) * step;
          moving = 1.4;
        }
      } else if (ped.state === 'walk') {
        ped.s += ped.dirSign * ped.speed * dt;
        const p = ringPoint(ped.ring, ped.s);
        ped.x = p.x;
        ped.z = p.z;
        ped.heading = Math.atan2(p.dir[0] * ped.dirSign, p.dir[1] * ped.dirSign);
        moving = 1;
        // a car bearing down fast makes them jump aside
        for (const car of cars) {
          if (car.dead) continue;
          const cs = Math.hypot(car.vx, car.vz);
          if (cs < 7) continue;
          const dx = ped.x - car.x;
          const dz = ped.z - car.z;
          const ahead = dx * (car.vx / cs) + dz * (car.vz / cs);
          if (ahead > 0 && ahead < 10 && Math.abs(dx * (car.vz / cs) - dz * (car.vx / cs)) < 3) {
            ped.state = 'flee';
            ped.panic = 2.4;
            ped.fleeX = ped.x + dx * 1.5 + randRange(this.rng, -3, 3);
            ped.fleeZ = ped.z + dz * 1.5 + randRange(this.rng, -3, 3);
            break;
          }
        }
      }
      // building collision while fleeing/following (walkers on rings never collide)
      if (ped.state === 'flee' || ped.state === 'follow') {
        const res = collideCircle(colliders, ped.x, ped.z, 0.42);
        ped.x = res.x;
        ped.z = res.z;
      }
      // car impacts
      if (ped.state !== 'down') {
        for (const car of cars) {
          if (car.dead) continue;
          const cs = Math.hypot(car.vx, car.vz);
          if (cs < 1.6) continue;
          if (Math.hypot(ped.x - car.x, ped.z - car.z) < 1.75) {
            ped.state = 'down';
            ped.downTime = randRange(this.rng, 4, 7);
            if (ctx.onPedHit) ctx.onPedHit(ped, car, cs);
            break;
          }
        }
      }
      // animate + place
      ped.walkPhase += dt * (moving > 0 ? 4.4 * moving + 2.6 : 0);
      const swing = moving > 0 ? Math.sin(ped.walkPhase) * 0.55 : 0;
      const ud = ped.mesh.userData;
      ud.legL.rotation.x = swing;
      ud.legR.rotation.x = -swing;
      ud.armL.rotation.x = -swing * 0.8;
      ud.armR.rotation.x = swing * 0.8;
      ped.mesh.position.set(ped.x, ped.state === 'walk' ? 0.22 : 0.02, ped.z);
      ped.mesh.rotation.y = ped.heading;
      void time;
    }
  }

  _rejoinRing(ped) {
    // snap back to the nearest ring so the walker resumes a believable stroll
    let best = null;
    let bestD = Infinity;
    for (const ring of this.rings) {
      const d = Math.hypot(ped.x - ring.cx, ped.z - ring.cz);
      if (d < bestD) {
        bestD = d;
        best = ring;
      }
    }
    ped.ring = best;
    // project onto the ring perimeter approximately via the nearest side
    const dx = ped.x - best.cx;
    const dz = ped.z - best.cz;
    const h = best.half;
    if (Math.abs(dx) > Math.abs(dz)) ped.s = dx > 0 ? 2 * h + (ped.z - (best.cz - h)) : 6 * h + (best.cz + h - ped.z);
    else ped.s = dz > 0 ? 4 * h + (best.cx + h - ped.x) : ped.x - (best.cx - h);
  }
}
