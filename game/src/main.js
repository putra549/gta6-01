// Marlowe Bay — the game itself. This module wires every system together: it builds
// the city, the fleet, the crowd and Reyes; runs the fixed-timestep simulation (menu,
// play, pause, busted and wasted states); owns the wanted level and its crimes; moves
// the camera; handles entering and leaving cars, shooting, busts and hospital trips;
// and saves progress. The screenshot scenes in shots.js drive this same game object.

import * as THREE from 'three';
import { LANDMARKS, PLAYER, WANTED } from './config.js';
import { makeRng } from './rng.js';
import { buildCity, collideCircle } from './city.js';
import { Fleet, stepCarPhysics, forwardSpeed, speedOf } from './vehicles.js';
import { Crowd } from './people.js';
import { Player } from './player.js';
import { Missions } from './missions.js';
import { Hud } from './hud.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { writeSave, readSave, clearSave } from './save.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 7) >>> 0;
const rng = makeRng(seed);

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1600);
camera.position.set(140, 70, 300);
camera.lookAt(0, 0, 0);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const city = buildCity(scene, rng);
const fleet = new Fleet(scene, rng);
fleet.fillParked(city.parkSpots);
const crowd = new Crowd(scene, city.sidewalkRings, rng);
const player = new Player(scene, rng);
const hud = new Hud();
const audio = new AudioEngine();
const input = new Input(canvas);

// the mission marker: a pillar of gold light plus a ground ring, moved each frame
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.3, depthWrite: false });
const marker = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 34, 12, 1, true), markerMat);
const markerRing = new THREE.Mesh(
  new THREE.RingGeometry(2.2, 3.1, 28),
  new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
);
markerRing.rotation.x = -Math.PI / 2;
scene.add(marker);
scene.add(markerRing);

// tracer + spark effects: a small pool of fading lines and sprites
const sparkTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.4, 'rgba(255,180,80,0.8)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const tracers = [];
for (let i = 0; i < 6; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, opacity: 0, depthWrite: false }));
  sprite.scale.set(1.4, 1.4, 1);
  scene.add(sprite);
  tracers.push({ line, sprite, life: 0 });
}
let tracerIdx = 0;
function fireTracer(from, to) {
  const t = tracers[tracerIdx++ % tracers.length];
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.sprite.position.set(to.x, to.y, to.z);
  t.life = 1;
}

// ---------------------------------------------------------------- state ------
const game = {
  time: 0,
  mode: 'menu', // menu | play | pause | busted | wasted
  cash: PLAYER.startCash,
  heat: 0,
  lastSeen: -99,
  lastCrime: -99,
  bustMeter: 0,
  hitCd: 0,
  toggleCd: 0, // E is enter AND exit: a short lockout stops one press doing both in a multi-step frame
  policeHitCd: 0,
  shake: 0,
  camYaw: Math.PI,
  camPitch: 0.34,
  saveTimer: 0,
  clockMinutes: 18 * 60 + 4,
  playerCar: null,
  autopilot: null,
  cameraOverride: null,
  sirenOn: false,
  player,
  fleet,
  crowd,
  hud,
  audio,
  input,
  missions: null,

  playerPos() {
    if (this.playerCar) return { x: this.playerCar.x, z: this.playerCar.z };
    return { x: player.x, z: player.z };
  },
  landmarkName(key) {
    return LANDMARKS[key] ? LANDMARKS[key].name : key;
  },
  setCash(n) {
    this.cash = n;
  },
  addCash(n, why) {
    this.cash += n;
    hud.showToast(`+$${n.toLocaleString('en-US')} — ${why}`, this.time);
  },
  setWanted(stars) {
    this.heat = Math.max(0, Math.min(5, stars));
    this.lastCrime = this.time;
    this.lastSeen = this.time;
  },
  /** Add heat for a crime; unforced crimes count fully only when somebody saw. */
  addHeat(amount, x, z, forced) {
    let seen = forced;
    if (!seen) {
      seen = crowd.witnessNear(x, z, 26) || fleet.cars.some((c) => c.kind === 'police' && Math.hypot(c.x - x, c.z - z) < 46);
    }
    this.heat = Math.min(5, this.heat + (seen ? amount : amount * 0.25));
    this.lastCrime = this.time;
    if (seen) this.lastSeen = this.time;
  },
  saveNow() {
    const pos = this.playerPos();
    writeSave({
      cash: this.cash,
      missionIndex: this.missions ? this.missions.index : 0,
      x: pos.x,
      z: pos.z,
      heading: this.playerCar ? this.playerCar.heading : player.heading,
      health: player.health,
    });
  },
  enterCar(car, opts = {}) {
    if (this.playerCar || car.dead) return;
    this.toggleCd = 0.35;
    car.kind = 'player';
    this.playerCar = car;
    player.mesh.visible = false;
    if (!opts.silent) {
      audio.door();
      const seen = crowd.witnessNear(car.x, car.z, 24) || fleet.cars.some((c) => c.kind === 'police' && Math.hypot(c.x - car.x, c.z - car.z) < 42);
      this.addHeat(seen ? WANTED.theftSeen : WANTED.theftUnseen, car.x, car.z, true);
      if (seen) hud.say('', 'Somebody saw that. The MBPD has your description.', 3.5, this.time);
      crowd.scare(car.x, car.z, 7);
    }
    audio.engineStart();
    this.camYaw = car.heading;
  },
  exitCar() {
    const car = this.playerCar;
    if (!car) return;
    this.toggleCd = 0.35;
    car.kind = 'parked';
    this.playerCar = null;
    const sx = Math.cos(car.heading);
    const sz = -Math.sin(car.heading);
    let px = car.x - sx * 2.3;
    let pz = car.z - sz * 2.3;
    const res = collideCircle(city.colliders, px, pz, 0.6);
    px = res.x;
    pz = res.z;
    player.place(px, pz, car.heading);
    player.mesh.visible = true;
    audio.door();
    audio.engineStop();
  },
  startGame(opts = {}) {
    input.pressed.clear(); // no stale menu keypress fires a shot or a car door in game
    input.clicked = false;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('endcard').classList.add('hidden');
    hud.show();
    this.mode = 'play';
    if (opts.fresh) {
      hud.say('Marla', 'Welcome to Marlowe Bay, Reyes. Gold marker, south side — that’s me. Try to arrive in one piece.', 6.5, this.time);
    }
  },
  step,
};
game.missions = new Missions(game);
const missions = game.missions;



// ---------------------------------------------------------------- crimes -----
function policeNear(x, z, r) {
  return fleet.cars.some((c) => c.kind === 'police' && !c.dead && Math.hypot(c.x - x, c.z - z) < r);
}

function onCarsCollide(a, b, impact) {
  const pc = game.playerCar;
  if (!pc || (a !== pc && b !== pc)) {
    if (impact > 6 && Math.hypot(a.x - player.x, a.z - player.z) < 26) audio.crash(impact / 16);
    return;
  }
  const other = a === pc ? b : a;
  audio.crash(Math.min(1, impact / 13));
  game.shake = Math.min(0.55, impact * 0.035);
  if (other.kind === 'police' && impact > 3.4 && game.time > game.policeHitCd) {
    game.policeHitCd = game.time + 1.6;
    game.addHeat(WANTED.policeHit, other.x, other.z, true);
  } else if (impact > 6.5) {
    game.addHeat(WANTED.carRam, other.x, other.z, false);
  }
  if (impact > 9) {
    player.hurt((impact - 9) * 0.85);
    hud.flashDamage();
  }
}

function onPedHit(ped, car, speed) {
  crowd.scare(ped.x, ped.z, 13);
  if (car === game.playerCar) {
    game.addHeat(WANTED.pedHit, ped.x, ped.z, true);
    audio.crash(0.3);
    hud.say('', 'You hit someone. The whole street saw it.', 3.5, game.time);
  }
}

// ---------------------------------------------------------------- shooting ---
function tryShoot() {
  const now = game.time;
  const origin = camera.position.clone();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  player.heading = game.camYaw;
  const hit = player.shoot(now, origin, dir, { colliders: city.colliders, cars: fleet.cars, peds: crowd.peds });
  if (!hit) return;
  if (hit.kind === 'empty') {
    audio.emptyClick();
    return;
  }
  audio.gunshot();
  const from = {
    x: player.x + Math.sin(player.heading) * 0.55,
    y: 1.25,
    z: player.z + Math.cos(player.heading) * 0.55,
  };
  fireTracer(from, hit.point);
  crowd.scare(player.x, player.z, 17);
  if (crowd.witnessNear(player.x, player.z, 27) || policeNear(player.x, player.z, 48)) {
    game.addHeat(WANTED.shotFired, player.x, player.z, true);
  }
  if (hit.kind === 'ped' && hit.target) {
    hit.target.state = 'down';
    hit.target.downTime = 5.5;
    game.addHeat(WANTED.pedShot, hit.target.x, hit.target.z, true);
    crowd.scare(hit.target.x, hit.target.z, 15);
  } else if (hit.kind === 'car' && hit.target) {
    hit.target.health -= 7;
    if (hit.target.kind === 'police') game.addHeat(WANTED.policeHit, hit.target.x, hit.target.z, true);
    crowd.scare(hit.point.x, hit.point.z, 10);
  }
}

// ------------------------------------------------------------- busted/wasted -
const fadeEl = document.getElementById('fade');
function fadeThrough(mid) {
  fadeEl.style.opacity = 1;
  window.setTimeout(() => {
    mid();
    fadeEl.style.opacity = 0;
  }, 480);
}

function doBusted() {
  const stars = Math.max(1, Math.round(game.heat));
  const fine = Math.min(game.cash, 100 + 120 * stars);
  game.cash -= fine;
  game.mode = 'busted';
  audio.sting();
  audio.siren(false);
  game.sirenOn = false;
  if (game.playerCar) game.exitCar();
  document.exitPointerLock && document.exitPointerLock();
  const t = document.getElementById('endtitle');
  t.textContent = 'BUSTED';
  t.className = 'busted';
  document.getElementById('endtext').textContent =
    'The interceptors boxed Reyes in. A night in the cells at Central, a fine, and a long walk home.';
  document.getElementById('endfine').textContent = `Fine paid: $${fine.toLocaleString('en-US')} · Released at Marlowe Bay Police — Central`;
  document.getElementById('endcard').classList.remove('hidden');
  game.pendingRespawn = 'police';
}

function doWasted() {
  const fee = Math.min(game.cash, Math.floor(game.cash * PLAYER.hospitalFeeRate), PLAYER.hospitalFeeCap);
  game.cash -= fee;
  game.mode = 'wasted';
  audio.sting();
  audio.siren(false);
  game.sirenOn = false;
  if (game.playerCar) game.exitCar();
  document.exitPointerLock && document.exitPointerLock();
  const t = document.getElementById('endtitle');
  t.textContent = 'WASTED';
  t.className = 'wasted';
  document.getElementById('endtext').textContent =
    'Reyes woke up under the fluorescent lights of St. Solana Hospital. The bay is still out there.';
  document.getElementById('endfine').textContent = `Hospital bill: $${fee.toLocaleString('en-US')} · Discharged at St. Solana Hospital`;
  document.getElementById('endcard').classList.remove('hidden');
  game.pendingRespawn = 'hospital';
}

function respawn() {
  const at = game.pendingRespawn === 'police' ? LANDMARKS.police.at : LANDMARKS.hospital.at;
  fadeThrough(() => {
    player.place(at.x, at.z, 0);
    player.healFull();
    player.mesh.visible = true;
    game.setWanted(0);
    game.bustMeter = 0;
    document.getElementById('endcard').classList.add('hidden');
    game.mode = 'play';
    game.saveNow();
  });
}

// ---------------------------------------------------------------- the step ---
function step(dt) {
  game.time += dt;
  const time = game.time;
  if (game.mode !== 'play') return;
  game.toggleCd = Math.max(0, game.toggleCd - dt);
  const pos = game.playerPos();

  // --- player body / car
  const events = {};
  if (game.playerCar) {
    const car = game.playerCar;
    hud.setPrompt(null);
    let inputForCar;
    if (game.autopilot) {
      inputForCar = game.autopilot(game) || { throttle: 0, steer: 0, handbrake: false };
    } else {
      const steer = (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
      inputForCar = {
        throttle: (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0),
        steer,
        handbrake: input.down('Space'),
      };
      if (input.down('ShiftLeft', 'ShiftRight')) inputForCar.throttle = Math.min(1, inputForCar.throttle + 0.25);
    }
    car.lastThrottle = inputForCar.throttle;
    events.impact = 0;
    const healthBefore = car.health;
    stepCarPhysics(car, inputForCar, dt, city.colliders, events);
    if (events.impact > 3.5) {
      car.health -= events.impact * 2.1;
      audio.crash(Math.min(1, events.impact / 13));
      game.shake = Math.min(0.55, events.impact * 0.04);
      if (events.impact > 10.5) {
        player.hurt((events.impact - 10.5) * 1.1);
        hud.flashDamage();
      }
    }
    if (car.health < healthBefore - 30 && car.health < 30) hud.say('', 'This car is falling apart. Find another ride.', 3.5, time);
    if (car.dead) {
      hud.say('', 'The car is dead. Out — on foot, Reyes.', 4, time);
      game.exitCar();
    }
    // camera follows the car
    const targetYaw = car.heading;
    let diff = targetYaw - game.camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const spd = Math.abs(forwardSpeed(car));
    game.camYaw += diff * Math.min(1, dt * (1.1 + spd * 0.06));
    const md = input.takeMouse();
    game.camYaw -= md.dx * 0.0032;
    game.camPitch = Math.max(0.06, Math.min(1.15, game.camPitch + md.dy * 0.0026));
    audio.engineUpdate(Math.min(1, spd / car.cfg.top), Math.abs(inputForCar.throttle));
    if (input.wasPressed('KeyE') && game.toggleCd <= 0 && Math.abs(forwardSpeed(car)) < 14) game.exitCar();
  } else {
    const md = input.takeMouse();
    game.camYaw -= md.dx * 0.0032;
    game.camPitch = Math.max(0.06, Math.min(1.15, game.camPitch + md.dy * 0.0026));
    const moving = player.updateOnFoot(dt, input, game.camYaw, city.colliders);
    void moving;
    // ground height: sidewalks are raised
    let gy = 0.02;
    for (const ring of city.sidewalkRings) {
      if (Math.abs(player.x - ring.cx) <= ring.half + 0.4 && Math.abs(player.z - ring.cz) <= ring.half + 0.4) {
        gy = 0.22;
        break;
      }
    }
    player.mesh.position.y = gy;
    // enter a car
    const near = fleet.nearestEnterable(player.x, player.z, 3.6);
    if (near) {
      hud.setPrompt(`<b>E</b> Enter the ${near.cfg.name}`);
      if (input.wasPressed('KeyE') && game.toggleCd <= 0) game.enterCar(near);
    } else {
      hud.setPrompt(null);
    }
    // shooting
    if (input.clicked) tryShoot();
    if (input.wasPressed('KeyR') && player.startReload(time)) audio.reload();
    // run over by traffic?
    game.hitCd -= dt;
    if (game.hitCd <= 0) {
      for (const car of fleet.cars) {
        if (car.dead || car.kind === 'parked') continue;
        const cs = speedOf(car);
        if (cs > 2.4 && Math.hypot(car.x - player.x, car.z - player.z) < 1.85) {
          player.hurt(cs * 1.7);
          hud.flashDamage();
          audio.crash(0.4);
          player.vx = (car.vx / cs) * 7;
          player.vz = (car.vz / cs) * 7;
          game.hitCd = 0.9;
          crowd.scare(player.x, player.z, 10);
          break;
        }
      }
    }
  }
  player.updateGun(time);

  // --- world systems
  fleet.update(dt, {
    playerPos: game.playerPos(),
    playerCar: game.playerCar,
    playerVel: game.playerCar ? { x: game.playerCar.vx, z: game.playerCar.vz } : { x: player.vx, z: player.vz },
    wanted: game.heat >= 0.75 ? Math.max(1, Math.round(game.heat)) : 0,
    colliders: city.colliders,
    time,
    onCarsCollide,
    onHonk: (car) => {
      if (Math.hypot(car.x - pos.x, car.z - pos.z) < 30) audio.horn();
    },
    onPoliceCrash: (impact) => {
      if (Math.hypot(player.x - pos.x, player.z - pos.z) < 30) audio.crash(Math.min(0.6, impact / 16));
    },
  });
  crowd.update(dt, { cars: fleet.cars, colliders: city.colliders, time, onPedHit });
  city.update(dt, time);
  missions.update(dt);

  // --- wanted: sight, decay, bust
  const seenNow = policeNear(pos.x, pos.z, 62) || crowd.witnessNear(pos.x, pos.z, 21);
  if (seenNow && game.heat > 0) game.lastSeen = time;
  if (game.heat > 0 && time - game.lastSeen > WANTED.decayDelay && time - game.lastCrime > 4) {
    game.heat = Math.max(0, game.heat - WANTED.decayPerSecond * dt);
  }
  const sirenShould = game.heat >= 0.75 && policeNear(pos.x, pos.z, 95);
  if (sirenShould !== game.sirenOn) {
    game.sirenOn = sirenShould;
    audio.siren(sirenShould);
  }
  if (game.heat >= 0.75) {
    let nearest = Infinity;
    for (const c of fleet.cars) {
      if (c.kind === 'police' && !c.dead) nearest = Math.min(nearest, Math.hypot(c.x - pos.x, c.z - pos.z));
    }
    const mySpeed = game.playerCar ? Math.abs(forwardSpeed(game.playerCar)) : Math.hypot(player.vx, player.vz);
    if (nearest < 9 && mySpeed < 1.7) game.bustMeter += dt / 2.6;
    else game.bustMeter = Math.max(0, game.bustMeter - dt * 1.3);
    hud.setBusted(game.bustMeter > 0.03 ? game.bustMeter : null);
    if (game.bustMeter >= 1) {
      hud.setBusted(null);
      doBusted();
      return;
    }
  } else {
    game.bustMeter = 0;
    hud.setBusted(null);
  }
  if (player.health <= 0) {
    doWasted();
    return;
  }

  // --- mission marker visuals
  const mp = missions.markerPos();
  if (mp) {
    marker.visible = true;
    markerRing.visible = true;
    marker.position.set(mp.x, 17, mp.z);
    markerRing.position.set(mp.x, 0.35, mp.z);
    markerRing.scale.setScalar(1 + Math.sin(time * 3.4) * 0.12);
    markerMat.opacity = 0.24 + Math.sin(time * 3.4) * 0.08;
  } else {
    marker.visible = false;
    markerRing.visible = false;
  }

  // --- HUD
  hud.setHealth(player.health);
  hud.setCash(game.cash);
  hud.setStars(game.heat);
  hud.setWeapon(player.mag, player.reserve, time < player.reloadUntil, !!game.playerCar);
  hud.setCrosshair(!game.playerCar);
  if (game.playerCar) hud.setSpeed(Math.abs(forwardSpeed(game.playerCar)) * 3.6, game.playerCar.cfg.name);
  else hud.setSpeed(null);
  hud.setObjective(missions.objective());
  game.clockMinutes += dt * 0.55;
  hud.setClock(game.clockMinutes);
  hud.update(time);
  hud.drawMinimap(
    {
      player: { x: pos.x, z: pos.z, heading: game.playerCar ? game.playerCar.heading : player.heading },
      cars: fleet.cars,
      target: mp,
    },
    time,
  );

  // --- camera
  updateCamera(dt);

  // --- periodic save
  game.saveTimer += dt;
  if (game.saveTimer > 20) {
    game.saveTimer = 0;
    game.saveNow();
  }
  game.shake = Math.max(0, game.shake - dt * 1.4);
}

function updateCamera(dt) {
  void dt;
  if (game.cameraOverride) {
    const o = game.cameraOverride;
    camera.position.set(o.pos.x, o.pos.y, o.pos.z);
    camera.lookAt(o.look.x, o.look.y, o.look.z);
    return;
  }
  const pos = game.playerPos();
  const dist = game.playerCar ? 10.8 : 7.6;
  const fx = Math.sin(game.camYaw);
  const fz = Math.cos(game.camYaw);
  const horiz = Math.cos(game.camPitch) * dist;
  let cx = pos.x - fx * horiz;
  let cz = pos.z - fz * horiz;
  let cy = (game.playerCar ? 1.2 : 1.6) + Math.sin(game.camPitch) * dist;
  const res = collideCircle(city.colliders, cx, cz, 0.6);
  cx = res.x;
  cz = res.z;
  cy = Math.max(1.1, cy);
  if (game.shake > 0) {
    cx += (Math.random() - 0.5) * game.shake;
    cy += (Math.random() - 0.5) * game.shake * 0.6;
    cz += (Math.random() - 0.5) * game.shake;
  }
  camera.position.set(cx, cy, cz);
  camera.lookAt(pos.x + fx * 6, (game.playerCar ? 1.4 : 1.7), pos.z + fz * 6);
}

// ------------------------------------------------------------- menu wiring ---
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const continueBtn = document.getElementById('btn-continue');
function refreshContinue() {
  continueBtn.disabled = !readSave();
}
refreshContinue();

document.getElementById('btn-start').addEventListener('click', () => {
  audio.start();
  audio.click();
  clearSave();
  game.cash = PLAYER.startCash;
  missions.restore(0);
  player.place(LANDMARKS.safehouse.at.x, LANDMARKS.safehouse.at.z, Math.PI);
  player.healFull();
  game.setWanted(0);
  game.startGame({ fresh: true });
  game.saveNow();
});
continueBtn.addEventListener('click', () => {
  audio.start();
  audio.click();
  const save = readSave();
  if (!save) return;
  game.cash = save.cash;
  missions.restore(save.missionIndex || 0);
  player.place(save.x ?? LANDMARKS.safehouse.at.x, save.z ?? LANDMARKS.safehouse.at.z, save.heading ?? Math.PI);
  player.health = Math.max(20, save.health ?? 100);
  game.setWanted(0);
  game.startGame({ fresh: false });
  hud.say('', 'Welcome back to Marlowe Bay.', 3.5, game.time);
});
document.getElementById('btn-resume').addEventListener('click', () => {
  audio.click();
  pauseEl.classList.add('hidden');
  game.mode = 'play';
});
document.getElementById('btn-quit').addEventListener('click', () => {
  audio.click();
  game.saveNow();
  pauseEl.classList.add('hidden');
  hud.hide();
  menuEl.classList.remove('hidden');
  game.mode = 'menu';
  refreshContinue();
});
document.getElementById('btn-respawn').addEventListener('click', () => {
  audio.click();
  respawn();
});
canvas.addEventListener('click', () => {
  audio.start();
  if (game.mode === 'play') input.lockPointer(canvas);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    const muted = audio.toggleMute();
    hud.say('', muted ? 'Sound off.' : 'Sound on.', 1.6, game.time);
  }
  if ((e.code === 'Escape' || e.code === 'KeyP') && game.mode === 'play') {
    game.mode = 'pause';
    document.getElementById('pausestats').textContent =
      `Cash $${game.cash.toLocaleString('en-US')} · ${missions.index >= 4 ? 'Story complete — free roam' : `Next job: ${missions.def().title}`} · Wanted ${Math.round(game.heat)} star${Math.round(game.heat) === 1 ? '' : 's'}`;
    pauseEl.classList.remove('hidden');
    game.saveNow();
  } else if ((e.code === 'Escape' || e.code === 'KeyP') && game.mode === 'pause') {
    pauseEl.classList.add('hidden');
    game.mode = 'play';
  }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && game.mode === 'play' && !params.get('shot')) {
    // the browser took the lock away (Esc): treat it as a pause
    game.mode = 'pause';
    pauseEl.classList.remove('hidden');
  }
});

// ------------------------------------------------------------- effects tick --
function updateEffects(dt) {
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt * 9;
    const o = Math.max(0, t.life);
    t.line.material.opacity = o * 0.9;
    t.sprite.material.opacity = o;
    const s = 0.8 + (1 - o) * 1.6;
    t.sprite.scale.set(s, s, 1);
  }
}

// ------------------------------------------------------------------- loop ----
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;
let framesRendered = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  let dt = (nowMs - last) / 1000;
  last = nowMs;
  if (dt > 0.25) dt = 0.25;
  if (game.mode === 'menu') {
    // a slow harbour orbit behind the title
    const t = nowMs / 1000;
    camera.position.set(Math.sin(t * 0.05) * 190, 64 + Math.sin(t * 0.11) * 8, Math.cos(t * 0.05) * 190);
    camera.lookAt(0, 6, 20);
    city.update(dt, t);
    for (const car of fleet.cars) {
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.heading;
    }
  } else {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      step(STEP);
      acc -= STEP;
      n += 1;
    }
    if (n === 5) acc = 0;
    if (n > 0) input.endFrame(); // edges live until a step can see them, even on a slow frame
  }
  updateEffects(dt);
  renderer.render(scene, camera);
  framesRendered += 1;
  if (window.__shotPending && framesRendered > 25) window.__shotReady = true;
}

// ------------------------------------------------------------------- boot ----
player.place(LANDMARKS.safehouse.at.x, LANDMARKS.safehouse.at.z, Math.PI);
player.mesh.position.y = 0.22;
window.__game = game;
const shotName = params.get('shot');
if (shotName) {
  menuEl.classList.add('hidden');
  stageShot(shotName, game);
  window.__shotPending = true;
} else {
  hud.hide();
}
requestAnimationFrame(frame);
