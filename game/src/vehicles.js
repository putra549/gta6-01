// Cars: four original low-poly models built from boxes (Voyager Sedan, Pico
// Hatchback, Dune Runner Pickup, Sirocco Coupe) plus the MBPD Interceptor livery.
// One arcade physics step drives every car — the player's, traffic and police — so
// collisions feel the same whoever is at the wheel. Traffic follows the road grid
// lane by lane and queues behind obstacles; police run a pursuit steering model and
// ram. The Fleet owns every car in the world.

import * as THREE from 'three';
import { PITCH, GRID, ROAD_HALF, CAR_TYPES } from './config.js';
import { nodeAt, collideCircle } from './city.js';
import { pick, randRange } from './rng.js';

const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2733 });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14151a });
const trimMat = new THREE.MeshLambertMaterial({ color: 0x23242a });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 10);
wheelGeo.rotateZ(Math.PI / 2); // axle along X, so the tyre mesh spins on its local X

function box(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Build the mesh for one car type; userData carries the animated parts. */
export function buildCarMesh(type, color) {
  const paint = new THREE.MeshLambertMaterial({ color });
  const group = new THREE.Group();
  const wheels = [];
  const wheelAt = (x, z) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.37, z);
    const tyre = new THREE.Mesh(wheelGeo, tyreMat);
    pivot.add(tyre);
    group.add(pivot);
    wheels.push(pivot);
    return pivot;
  };
  if (type === 'pickup') {
    group.add(box(1.9, 0.62, 4.5, paint, 0, 0.62, 0)); // bed + body
    group.add(box(1.8, 0.62, 1.7, paint, 0, 1.2, 0.95)); // cab
    group.add(box(1.62, 0.5, 1.5, glassMat, 0, 1.24, 0.95));
    group.add(box(1.86, 0.3, 1.9, trimMat, 0, 0.78, -1.25)); // bed liner
  } else if (type === 'coupe') {
    group.add(box(1.86, 0.5, 4.4, paint, 0, 0.55, 0));
    group.add(box(1.6, 0.42, 1.9, glassMat, 0, 0.98, -0.25));
    group.add(box(1.9, 0.09, 0.5, trimMat, 0, 1.02, -2.05)); // spoiler
    group.add(box(0.12, 0.3, 0.4, trimMat, -0.7, 0.82, -2.05));
    group.add(box(0.12, 0.3, 0.4, trimMat, 0.7, 0.82, -2.05));
  } else if (type === 'hatch') {
    group.add(box(1.78, 0.58, 3.7, paint, 0, 0.58, 0));
    group.add(box(1.62, 0.55, 2.2, glassMat, 0, 1.1, -0.3));
    group.add(box(1.7, 0.2, 0.7, paint, 0, 0.95, -1.75));
  } else {
    // sedan (and the police interceptor share this shell)
    group.add(box(1.84, 0.56, 4.3, paint, 0, 0.58, 0));
    group.add(box(1.64, 0.52, 2.1, glassMat, 0, 1.08, -0.2));
    group.add(box(1.7, 0.16, 0.9, paint, 0, 0.92, 1.85));
  }
  group.add(box(1.7, 0.14, 0.24, headMat, -0.45, 0.68, 2.16));
  group.add(box(0.5, 0.14, 0.1, headMat, -0.55, 0.68, 2.16));
  group.add(box(0.5, 0.14, 0.1, headMat, 0.55, 0.68, 2.16));
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x881111 });
  const brake = box(1.6, 0.13, 0.08, brakeMat, 0, 0.7, -2.16);
  group.add(brake);
  const fl = wheelAt(-0.85, 1.45);
  const fr = wheelAt(0.85, 1.45);
  wheelAt(-0.85, -1.45);
  wheelAt(0.85, -1.45);
  const ud = { wheels, frontWheels: [fl, fr], brakeMat, lightL: null, lightR: null, smoke: null };
  if (type === 'police') {
    group.add(box(1.5, 0.16, 0.5, trimMat, 0, 1.42, -0.2)); // light bar base
    const lm = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const rm = new THREE.MeshBasicMaterial({ color: 0x2266ff });
    ud.lightL = box(0.6, 0.2, 0.42, lm, -0.38, 1.56, -0.2);
    ud.lightR = box(0.6, 0.2, 0.42, rm, 0.38, 1.56, -0.2);
    group.add(ud.lightL);
    group.add(ud.lightR);
    const stripe = box(1.86, 0.2, 4.32, new THREE.MeshLambertMaterial({ color: 0x1d2f4a }), 0, 0.62, 0);
    group.add(stripe);
  }
  const smoke = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 7, 5),
    new THREE.MeshLambertMaterial({ color: 0x555560, transparent: true, opacity: 0.55 }),
  );
  smoke.position.set(0, 1.25, 1.6);
  smoke.visible = false;
  group.add(smoke);
  ud.smoke = smoke;
  group.userData = ud;
  return group;
}

let nextCarId = 1;

/** Make a car record (not yet added to a scene). */
export function makeCar(type, color, x, z, heading) {
  const cfg = CAR_TYPES[type];
  return {
    id: nextCarId++,
    type,
    cfg,
    color,
    mesh: buildCarMesh(type, color),
    x,
    z,
    heading,
    vx: 0,
    vz: 0,
    steerVis: 0,
    kind: 'parked', // parked | traffic | police | player
    health: 100,
    dead: false,
    // traffic route state
    fromI: 0,
    fromJ: 0,
    toI: 0,
    toJ: 0,
    cruise: 10.5,
    stuckTime: 0,
    reverseTime: 0,
    honkCd: 0,
  };
}

/** Forward speed of a car along its heading, m/s. */
export function forwardSpeed(car) {
  return car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading);
}

/** Total speed, m/s. */
export function speedOf(car) {
  return Math.hypot(car.vx, car.vz);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * The one arcade physics step. `input` is {throttle -1..1, steer -1..1, handbrake}.
 * Mutates the car; reports hard building impacts through events.impact.
 */
export function stepCarPhysics(car, input, dt, colliders, events) {
  const cfg = car.cfg;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const sx = Math.cos(car.heading);
  const sz = -Math.sin(car.heading);
  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * sx + car.vz * sz;

  const maxSteer = 0.55 / (1 + Math.abs(vf) * 0.05);
  const steerAngle = input.steer * maxSteer;
  if (Math.abs(vf) > 0.05) {
    car.heading += (vf / 2.7) * Math.tan(steerAngle) * dt * (input.handbrake ? 1.35 : 1);
  }
  car.steerVis += (steerAngle - car.steerVis) * Math.min(1, dt * 10);

  if (input.throttle > 0) {
    const room = Math.max(0, 1 - Math.max(0, vf) / (cfg.top * 1.12));
    vf += cfg.accel * input.throttle * room * dt + cfg.accel * input.throttle * 0.25 * dt;
  } else if (input.throttle < 0) {
    if (vf > 0.6) vf += input.throttle * 26 * dt; // brakes
    else vf = Math.max(-11, vf + cfg.accel * 0.7 * input.throttle * dt); // reverse
  } else {
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.6 * dt); // engine braking
  }
  if (input.handbrake) vf -= vf * 1.15 * dt;
  vf -= vf * 0.32 * dt; // drag
  const grip = input.handbrake ? cfg.grip * 0.28 : cfg.grip;
  vl *= Math.exp(-grip * dt);

  const nfx = Math.sin(car.heading);
  const nfz = Math.cos(car.heading);
  const nsx = Math.cos(car.heading);
  const nsz = -Math.sin(car.heading);
  car.vx = nfx * vf + nsx * vl;
  car.vz = nfz * vf + nsz * vl;
  const px = car.x;
  const pz = car.z;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  const res = collideCircle(colliders, car.x, car.z, 1.55);
  if (res.hit) {
    car.x = res.x;
    car.z = res.z;
    const cx = res.x - px;
    const cz = res.z - pz;
    const cl = Math.hypot(cx, cz);
    if (cl > 1e-4) {
      const nx = cx / cl;
      const nz = cz / cl;
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) {
        car.vx -= nx * vn * 1.5;
        car.vz -= nz * vn * 1.5;
        if (events && vn < -3) events.impact = Math.max(events.impact || 0, -vn);
      }
    }
  }
  // keep cars in the world and out of the sea
  car.x = Math.max(-272, Math.min(272, car.x));
  car.z = Math.max(-272, Math.min(262, car.z));
}

/** Push two cars apart and trade a little velocity; returns impact strength 0..~20. */
export function collideCars(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  const min = 3.4;
  if (d2 >= min * min || d2 < 1e-6) return 0;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  const push = (min - d) / 2;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;
  const rvx = b.vx - a.vx;
  const rvz = b.vz - a.vz;
  const rel = rvx * nx + rvz * nz;
  if (rel < 0) {
    const impulse = -rel * 0.62;
    a.vx -= nx * impulse;
    a.vz -= nz * impulse;
    b.vx += nx * impulse;
    b.vz += nz * impulse;
    return -rel;
  }
  return 0;
}

/** Lane point for travelling from node A to node B: right-hand lane, `ahead` past B. */
function laneTarget(car, ahead) {
  const a = nodeAt(car.fromI, car.fromJ);
  const b = nodeAt(car.toI, car.toJ);
  const dx = Math.sign(b.x - a.x);
  const dz = Math.sign(b.z - a.z);
  // right-hand offset: perpendicular (dz, -dx) of the travel direction
  const ox = dz * (ROAD_HALF - 3.4);
  const oz = -dx * (ROAD_HALF - 3.4);
  return { x: b.x + ox + dx * ahead, z: b.z + oz + dz * ahead };
}

/** Choose the next node for a traffic car arriving at (toI, toJ). */
function pickNextNode(car, rng) {
  const options = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [di, dj] of dirs) {
    const ni = car.toI + di;
    const nj = car.toJ + dj;
    if (ni < -GRID || ni > GRID || nj < -GRID || nj > GRID) continue;
    if (ni === car.fromI && nj === car.fromJ) continue; // no U-turn mid-grid
    options.push([ni, nj]);
  }
  if (!options.length) options.push([car.fromI, car.fromJ]); // dead end: turn around
  const [ni, nj] = pick(rng, options);
  car.fromI = car.toI;
  car.fromJ = car.toJ;
  car.toI = ni;
  car.toJ = nj;
}

/** Steering + throttle inputs that drive `car` toward a point at a desired speed. */
function driveToward(car, tx, tz, desiredSpeed, dt) {
  const dx = tx - car.x;
  const dz = tz - car.z;
  const dist = Math.hypot(dx, dz);
  const look = Math.max(4, Math.min(14, speedOf(car) * 0.7));
  const px = tx + Math.sin(car.heading) * 0; // target as given; caller adds lookahead
  const desired = Math.atan2(dx, dz);
  const diff = wrapAngle(desired - car.heading);
  const steer = Math.max(-1, Math.min(1, diff * 1.55));
  const vf = forwardSpeed(car);
  let throttle = Math.max(-1, Math.min(1, (desiredSpeed - vf) * 0.32));
  if (Math.abs(diff) > 2.2 && vf > 2) throttle = -0.7; // brake for a hairpin
  void look;
  void px;
  void dt;
  return { throttle, steer, handbrake: false, dist };
}

/** The fleet: every car in Marlowe Bay, and the AI that moves the un-driven ones. */
export class Fleet {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.cars = [];
    this.policeTimer = 0;
  }

  add(car) {
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    this.scene.add(car.mesh);
    this.cars.push(car);
    return car;
  }

  remove(car) {
    this.scene.remove(car.mesh);
    this.cars.splice(this.cars.indexOf(car), 1);
  }

  /** Fill the parking spots with stealable cars. */
  fillParked(spots) {
    const types = ['sedan', 'hatch', 'pickup', 'coupe'];
    for (const spot of spots) {
      const type = this.rng() < 0.16 ? 'coupe' : pick(this.rng, types);
      const color = pick(this.rng, CAR_TYPES[type].colors);
      const car = makeCar(type, color, spot.x, spot.z, spot.heading);
      car.kind = 'parked';
      this.add(car);
    }
  }

  /** Spawn a traffic car on a node ring away from (x, z). */
  spawnTraffic(x, z) {
    for (let tries = 0; tries < 12; tries += 1) {
      const i = Math.floor(this.rng() * (GRID * 2 + 1)) - GRID;
      const j = Math.floor(this.rng() * (GRID * 2 + 1)) - GRID;
      const n = nodeAt(i, j);
      if (Math.hypot(n.x - x, n.z - z) < 65) continue;
      const type = pick(this.rng, ['sedan', 'hatch', 'pickup', 'sedan', 'hatch']);
      const car = makeCar(type, pick(this.rng, CAR_TYPES[type].colors), n.x, n.z, 0);
      car.kind = 'traffic';
      car.fromI = i;
      car.fromJ = j;
      car.toI = i;
      car.toJ = j;
      pickNextNode(car, this.rng);
      const start = laneTarget(car, -PITCH + 6);
      car.x = start.x;
      car.z = start.z;
      car.heading = Math.atan2(car.toI - car.fromI, car.toJ - car.fromJ) || 0;
      car.cruise = randRange(this.rng, 8.5, 12);
      this.add(car);
      return car;
    }
    return null;
  }

  /** Spawn one interceptor at a node away from the player, aimed at the chase. */
  spawnPolice(x, z) {
    let best = null;
    let bestD = -1;
    for (let tries = 0; tries < 14; tries += 1) {
      const i = Math.floor(this.rng() * (GRID * 2 + 1)) - GRID;
      const j = Math.floor(this.rng() * (GRID * 2 + 1)) - GRID;
      const n = nodeAt(i, j);
      const d = Math.hypot(n.x - x, n.z - z);
      if (d > 55 && d < 150 && d > bestD) {
        best = n;
        bestD = d;
      }
    }
    if (!best) best = nodeAt(GRID, -GRID);
    const car = makeCar('police', 0xf2f2f2, best.x, best.z, Math.atan2(x - best.x, z - best.z));
    car.kind = 'police';
    car.cruise = 40;
    this.add(car);
    return car;
  }

  policeCount() {
    return this.cars.filter((c) => c.kind === 'police' && !c.dead).length;
  }

  /** The nearest car whose door the player at (x, z) can reach, or null. */
  nearestEnterable(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of this.cars) {
      if (car.kind === 'player' || car.dead) continue;
      if (speedOf(car) > 1.2) continue;
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  /**
   * Advance traffic and police one step. ctx: {playerPos, playerCar, wanted (stars),
   * colliders, time, onTrafficHit(car, strength), onPoliceHitPolice(strength)}.
   */
  update(dt, ctx) {
    const { playerPos, colliders } = ctx;
    // traffic population control
    const traffic = this.cars.filter((c) => c.kind === 'traffic');
    if (traffic.length < 12) this.spawnTraffic(playerPos.x, playerPos.z);
    for (const car of traffic) {
      if (Math.hypot(car.x - playerPos.x, car.z - playerPos.z) > 300) this.remove(car);
    }
    // police population follows the wanted level
    const wanted = ctx.wanted || 0;
    const targetPolice = wanted >= 1 ? Math.min(4, Math.floor(wanted) + 1) : 0;
    this.policeTimer -= dt;
    if (this.policeCount() < targetPolice && this.policeTimer <= 0) {
      this.spawnPolice(playerPos.x, playerPos.z);
      this.policeTimer = 3.5;
    }
    if (wanted < 1) {
      for (const car of this.cars) {
        if (car.kind === 'police' && Math.hypot(car.x - playerPos.x, car.z - playerPos.z) > 190) this.remove(car);
      }
    }

    const events = {};
    for (const car of this.cars) {
      if (car.kind === 'parked' || car.kind === 'player' || car.dead) continue;
      let input;
      if (car.kind === 'traffic') {
        input = this._trafficInput(car, ctx, dt);
      } else {
        input = this._policeInput(car, ctx, dt);
      }
      events.impact = 0;
      stepCarPhysics(car, input, dt, colliders, events);
      if (events.impact > 4) {
        car.health -= events.impact * 1.6; // AI drivers bend their own cars too
        if (car.kind === 'police' && ctx.onPoliceCrash) ctx.onPoliceCrash(events.impact);
      }
    }
    // car against car
    for (let i = 0; i < this.cars.length; i += 1) {
      for (let j = i + 1; j < this.cars.length; j += 1) {
        const a = this.cars[i];
        const b = this.cars[j];
        if (a.dead || b.dead) continue;
        const impact = collideCars(a, b);
        if (impact > 3.2) {
          a.health -= impact * 1.1;
          b.health -= impact * 1.1;
          if (ctx.onCarsCollide) ctx.onCarsCollide(a, b, impact);
        }
      }
    }
    // sync meshes, wheels, lights, smoke
    for (const car of this.cars) {
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.heading;
      const ud = car.mesh.userData;
      const vf = forwardSpeed(car);
      for (const w of ud.wheels) w.children[0].rotation.x += (vf * dt) / 0.37;
      for (const w of ud.frontWheels) w.rotation.y = car.steerVis;
      ud.brakeMat.color.setHex(Math.abs(vf) > 0.2 && car.lastThrottle < -0.05 ? 0xff3b30 : 0x881111);
      if (ud.lightL) {
        const phase = (ctx.time * 2.6 + car.id * 0.37) % 1;
        ud.lightL.visible = phase < 0.5;
        ud.lightR.visible = phase >= 0.5;
      }
      if (ud.smoke) {
        ud.smoke.visible = car.health < 38;
        if (ud.smoke.visible) {
          const s = 0.8 + Math.sin(ctx.time * 7 + car.id) * 0.25;
          ud.smoke.scale.set(s, s * 1.3, s);
        }
      }
      if (car.health <= 0 && !car.dead) {
        car.dead = true;
        car.health = 0;
      }
    }
  }

  _trafficInput(car, ctx, dt) {
    const target = laneTarget(car, 7);
    // obstacle scan: any car (or the player's) close ahead in our lane
    let desired = car.cruise;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const other of this.cars) {
      if (other === car || other.dead) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      if (ahead > 0 && ahead < 11 && Math.abs(side) < 2.4) {
        desired = Math.min(desired, Math.max(0, (ahead - 5.5) * 1.1) + Math.max(0, forwardSpeed(other)));
        if (ahead < 6 && car.honkCd <= 0) {
          car.honkCd = 2.5;
          if (ctx.onHonk) ctx.onHonk(car);
        }
      }
    }
    const p = ctx.playerCar;
    if (p && !p.dead) {
      const dx = p.x - car.x;
      const dz = p.z - car.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      if (ahead > 0 && ahead < 11 && Math.abs(side) < 2.4) desired = Math.min(desired, Math.max(0, (ahead - 5.5) * 1.1));
    }
    car.honkCd -= dt;
    // unstick: if we have barely moved with throttle on, back up briefly
    if (speedOf(car) < 0.4 && desired > 1) car.stuckTime += dt;
    else car.stuckTime = 0;
    if (car.stuckTime > 2.2) {
      car.reverseTime = 0.9;
      car.stuckTime = 0;
    }
    let input;
    if (car.reverseTime > 0) {
      car.reverseTime -= dt;
      input = { throttle: -0.8, steer: car.steerVis > 0 ? -0.8 : 0.8, handbrake: false };
    } else {
      input = driveToward(car, target.x, target.z, desired, dt);
    }
    car.lastThrottle = input.throttle;
    // arrived at node B?
    const b = nodeAt(car.toI, car.toJ);
    if (Math.hypot(car.x - b.x, car.z - b.z) < 9) pickNextNode(car, this.rng);
    return input;
  }

  _policeInput(car, ctx, dt) {
    const p = ctx.playerPos;
    const lead = 0.45;
    const tx = p.x + (ctx.playerVel ? ctx.playerVel.x * lead : 0);
    const tz = p.z + (ctx.playerVel ? ctx.playerVel.z * lead : 0);
    const dist = Math.hypot(p.x - car.x, p.z - car.z);
    const topSpeed = car.cfg.top * (0.9 + Math.min(5, ctx.wanted || 1) * 0.035);
    let desired = topSpeed;
    if (dist < 9) desired = Math.max(6, dist * 1.2); // close in to pin, don't just orbit
    if (speedOf(car) < 0.4) car.stuckTime += dt;
    else car.stuckTime = 0;
    if (car.stuckTime > 2) {
      car.reverseTime = 0.8;
      car.stuckTime = 0;
    }
    let input;
    if (car.reverseTime > 0) {
      car.reverseTime -= dt;
      input = { throttle: -0.9, steer: -car.steerVis, handbrake: false };
    } else {
      input = driveToward(car, tx, tz, desired, dt);
      if (dist > 26) input.throttle = 1;
    }
    car.lastThrottle = input.throttle;
    // a unit that falls hopelessly behind is quietly replaced nearer the action
    if (dist > 240) {
      const n = nodeAt(Math.max(-GRID, Math.min(GRID, Math.round(p.x / PITCH))), Math.max(-GRID, Math.min(GRID, Math.round(p.z / PITCH))));
      car.x = n.x + randRange(this.rng, -6, 6);
      car.z = n.z + randRange(this.rng, -6, 6);
      car.vx = 0;
      car.vz = 0;
    }
    return input;
  }
}
