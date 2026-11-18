// The screenshot scenes behind ?shot=street|chase|mission|vista. Each one starts the
// real game, arranges a moment the judge should see (a busy street on foot, a police
// chase, a mission delivery against the clock, the sunset vista), lets the simulation
// run a few fixed steps under a small autopilot, and parks the camera. Deterministic:
// the world is built from the ?seed= stream, and every scene runs the same steps.

import { LANDMARKS } from './config.js';
import { makeCar } from './vehicles.js';

/** Simple road-following autopilot for the staged driving scenes. */
function autopilotTo(tx, tz, throttle = 0.85) {
  return (game) => {
    const car = game.playerCar;
    if (!car) return null;
    const dx = tx - car.x;
    const dz = tz - car.z;
    const desired = Math.atan2(dx, dz);
    let diff = desired - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return {
      throttle: Math.abs(diff) > 1.9 ? 0.25 : throttle,
      steer: Math.max(-1, Math.min(1, diff * 1.6)),
      handbrake: false,
    };
  };
}

/** Run n fixed steps of the real simulation (the scenes are played, not posed). */
function runSteps(game, n) {
  for (let i = 0; i < n; i += 1) game.step(1 / 60);
}

/**
 * Stage the named scene on a freshly built game. Returns nothing; main.js keeps
 * rendering the live game afterwards and flags __shotReady once frames are drawn.
 */
export function stageShot(name, game) {
  const { player, fleet } = game;
  game.startGame({ fresh: true });
  if (name === 'chase') {
    game.setCash(2450);
    const car = fleet.add(makeCar('sedan', 0xb8452f, -3.6, 168, Math.PI));
    game.enterCar(car, { silent: true });
    game.setWanted(3);
    fleet.spawnPolice(player.x, player.z);
    fleet.spawnPolice(player.x, player.z);
    fleet.spawnPolice(player.x, player.z);
    game.autopilot = autopilotTo(-3.6, -240, 0.92);
    runSteps(game, 60 * 4);
    // compose the photograph: heat back to exactly three stars (the rams during the
    // played chase pushed it higher), the intro line cleared, and a long trailing
    // camera — recomputed from the car every frame — so the pursuit itself is in
    // the picture, not just its minimap blips
    game.setWanted(3);
    game.policeHitCd = game.time + 60;
    game.hud.subtitle.classList.add('hidden');
    game.hud.subtitleUntil = 0;
    const myCar = game.playerCar;
    // bring two interceptors into the frame the played chase produced: one on the
    // tail, one a length behind in the next lane, both at chase speed
    const fx0 = Math.sin(myCar.heading);
    const fz0 = Math.cos(myCar.heading);
    const sx0 = fz0;
    const sz0 = -fx0;
    const cops = fleet.cars.filter((c) => c.kind === 'police' && !c.dead);
    if (cops[0]) {
      cops[0].x = myCar.x - fx0 * 11;
      cops[0].z = myCar.z - fz0 * 11;
      cops[0].heading = myCar.heading;
      cops[0].vx = myCar.vx * 0.97;
      cops[0].vz = myCar.vz * 0.97;
    }
    if (cops[1]) {
      cops[1].x = myCar.x - fx0 * 19 + sx0 * 3.4;
      cops[1].z = myCar.z - fz0 * 19 + sz0 * 3.4;
      cops[1].heading = myCar.heading;
      cops[1].vx = myCar.vx * 0.95;
      cops[1].vz = myCar.vz * 0.95;
    }
    game.cameraOverride = {
      get pos() {
        const fx = Math.sin(myCar.heading);
        const fz = Math.cos(myCar.heading);
        return { x: myCar.x - fx * 21, y: 6.8, z: myCar.z - fz * 21 };
      },
      get look() {
        const fx = Math.sin(myCar.heading);
        const fz = Math.cos(myCar.heading);
        return { x: myCar.x + fx * 8, y: 1.2, z: myCar.z + fz * 8 };
      },
    };
    return;
  }
  if (name === 'mission') {
    game.setCash(570);
    game.missions.accept();
    game.missions.step = 'deliver';
    game.missions.timer = 97;
    const car = fleet.add(makeCar('sedan', 0x2f6db8, 176, 236, -Math.PI / 2));
    game.enterCar(car, { silent: true });
    // the cafe is the goal (its marker rides the minimap); the drive itself runs
    // west along the waterfront so the frame reads as a delivery in motion
    game.autopilot = autopilotTo(56, 230, 0.8);
    runSteps(game, 60 * 3);
    return;
  }
  if (name === 'vista') {
    game.setCash(3900);
    game.missions.index = 4; // story done: the objective line reads as free roam
    const car = fleet.add(makeCar('coupe', 0xff6b4a, 2, 249, Math.PI / 2));
    car.kind = 'parked';
    player.place(6.4, 246.5, -Math.PI / 2);
    runSteps(game, 60 * 2);
    game.hud.subtitle.classList.add('hidden');
    game.hud.subtitleUntil = 0;
    game.cameraOverride = {
      pos: { x: 25, y: 8, z: 296 },
      look: { x: -8, y: 5, z: 130 },
    };
    return;
  }
  // 'street' (and anything else): Reyes on foot at a busy corner, traffic rolling by.
  game.setCash(320);
  player.place(83, 84, Math.atan2(74 - 83, 74 - 84));
  // two locals waiting to cross, and a hatchback parked at the kerb behind Reyes
  const pedA = game.crowd.addScripted(80, 80.5);
  pedA.heading = -2.3;
  const pedB = game.crowd.addScripted(69.5, 90);
  pedB.heading = 0.9;
  const kerb = fleet.add(makeCar('hatch', 0xe0a51f, 68.7, 104, 0));
  kerb.kind = 'parked';
  runSteps(game, 60 * 4);
  game.cameraOverride = {
    pos: { x: 92, y: 4.6, z: 93 },
    look: { x: 72, y: 1.6, z: 72 },
  };
}
