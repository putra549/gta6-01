// The story: four jobs for fixer Marla Venn, chained in order, with free roam between
// and after them. A Missions instance is a small state machine — an offered job waits
// at its start marker; walking into the marker takes the job; each job is a few steps
// with a world target, optional timer or damage budget, dialogue lines and a cash
// reward. After the finale the chain can be replayed from the safehouse.

import { LANDMARKS } from './config.js';
import { makeCar } from './vehicles.js';

const MARLA = 'Marla';
const REYES = 'Reyes';

export const MISSION_DEFS = [
  {
    title: 'First Run',
    reward: 450,
    startAt: 'safehouse',
    intro: "First job's simple, Reyes. Warehouse 9 at the docks has a package with my name on it. Fetch it, then drop it at Cafe Solana. Clock's running once it's in your hands.",
  },
  {
    title: 'Nervous Wreck',
    reward: 700,
    startAt: 'safehouse',
    intro: "My cousin Silvio is at the Hotel Marlin with a suitcase he won't explain. Pick him up, get him to the docks, and — Reyes — he faints at scratches. Bring him AND the car back smooth.",
  },
  {
    title: 'Borrowed Wheels',
    reward: 900,
    startAt: 'safehouse',
    intro: "There's a coral Sirocco Coupe parked at the Palms Beach Lot whose owner owes me money. Take it. Sal's Garage, north-east, will know what to do with it. If the law notices, that's your problem.",
  },
  {
    title: 'The Long Way Home',
    reward: 1500,
    startAt: 'cafe',
    intro: "Last one, and it's hot: half the MBPD is rolling toward this cafe. Get back to the safehouse, Reyes. However you have to.",
  },
];

export class Missions {
  /** game: the live world (player, fleet, crowd, hud, audio, addCash, setWanted, addHeat). */
  constructor(game) {
    this.game = game;
    this.index = 0; // next mission to offer (0..3); 4 = chain finished
    this.active = false;
    this.step = 'offer'; // offer | pickup | deliver | ride | steal | escape | done
    this.timer = 0;
    this.passenger = null;
    this.boardHealth = 100;
    this.markedCar = null;
    this.failed = false;
    this.hintShown = false;
    this.replayArm = true; // the post-finale replay needs the player to step out and back in
  }

  /** The def of the mission currently offered or running. */
  def() {
    return MISSION_DEFS[Math.min(this.index, MISSION_DEFS.length - 1)];
  }

  /** World position of the current marker (offer point or step target), or null. */
  markerPos() {
    const L = LANDMARKS;
    if (!this.active) {
      if (this.index >= MISSION_DEFS.length) return L.safehouse.at;
      return L[MISSION_DEFS[this.index].startAt].at;
    }
    switch (this.index) {
      case 0:
        return this.step === 'pickup' ? L.docks.at : L.cafe.at;
      case 1:
        return this.step === 'pickup' ? L.hotel.at : L.docks.at;
      case 2:
        if (this.step === 'steal' && this.markedCar) return { x: this.markedCar.x, z: this.markedCar.z };
        return L.garage.at;
      case 3:
        return L.safehouse.at;
      default:
        return null;
    }
  }

  /** The HUD objective line for the current state. */
  objective() {
    const d = this.def();
    if (!this.active) {
      if (this.index >= MISSION_DEFS.length) return `<b>Free roam.</b> The bay is yours — Marla's marker at the safehouse replays her jobs.`;
      return `<b>${d.title}</b> — meet Marla at the <b>gold marker</b> (${this.game.landmarkName(MISSION_DEFS[this.index].startAt)}).`;
    }
    const t = this.timer > 0 ? ` <span class="timer">${Math.ceil(this.timer)}s</span>` : '';
    switch (`${this.index}:${this.step}`) {
      case '0:pickup':
        return `<b>First Run:</b> pick up the package at <b>Warehouse 9</b>, Marlowe Docks.`;
      case '0:deliver':
        return `<b>First Run:</b> deliver the package to <b>Cafe Solana</b>.${t}`;
      case '1:pickup':
        return `<b>Nervous Wreck:</b> pick up Silvio at the <b>Hotel Marlin</b> — bring a car to the marker.`;
      case '1:ride': {
        const damage = this.game.playerCar ? this.boardHealth - this.game.playerCar.health : 0;
        return `<b>Nervous Wreck:</b> drive Silvio to the <b>docks</b>. Keep the car smooth — damage budget left: <b>${Math.max(0, Math.round(45 - damage))}</b>.`;
      }
      case '2:steal':
        return `<b>Borrowed Wheels:</b> steal the <b>coral Sirocco Coupe</b> at the Palms Beach Lot.`;
      case '2:deliver':
        return `<b>Borrowed Wheels:</b> deliver the coupe to <b>Sal's Garage</b>.`;
      case '3:escape':
        return `<b>The Long Way Home:</b> lose yourself — reach the <b>Harbour View Safehouse</b>.`;
      default:
        return '';
    }
  }

  /** Spawn the marked coupe when mission 3 becomes the offered job. */
  ensureMarkedCar() {
    if (this.index !== 2 || this.markedCar) return;
    const car = makeCar('coupe', 0xff6b4a, LANDMARKS.beachlot.at.x - 6, LANDMARKS.beachlot.at.z + 2, Math.PI / 2);
    car.kind = 'parked';
    car.missionMarked = true;
    this.markedCar = this.game.fleet.add(car);
  }

  /** Begin the offered mission (player walked into the start marker). */
  accept() {
    const d = this.def();
    const g = this.game;
    this.active = true;
    this.hintShown = false;
    g.audio.pickup();
    g.hud.say(MARLA, d.intro, 7.5, g.time);
    if (this.index === 0) this.step = 'pickup';
    if (this.index === 1) {
      this.step = 'pickup';
      this.passenger = g.crowd.addScripted(LANDMARKS.hotel.at.x + 3, LANDMARKS.hotel.at.z + 4);
    }
    if (this.index === 2) {
      this.step = 'steal';
      this.ensureMarkedCar();
    }
    if (this.index === 3) {
      this.step = 'escape';
      g.setWanted(3);
      g.hud.say(MARLA, 'Sirens already. Move, Reyes — MOVE.', 4, g.time + 7.5);
    }
  }

  /** End the current mission with its reward and move the chain on. */
  complete() {
    const d = this.def();
    const g = this.game;
    g.addCash(d.reward, d.title);
    g.audio.reward();
    this.active = false;
    this.step = 'offer';
    this.timer = 0;
    this.index += 1;
    if (this.index === 2) this.ensureMarkedCar();
    if (this.index >= MISSION_DEFS.length) {
      this.replayArm = false; // the finale ends at the safehouse: don't instantly restart
      g.hud.say(MARLA, "That's the last of it. The bay's yours now, Reyes — you earned it. Come by the safehouse if you ever want to run it all again.", 8, g.time);
    }
    g.saveNow();
  }

  /** Fail the current mission: back to the offer marker, no reward. */
  fail(reason) {
    const g = this.game;
    g.audio.fail();
    g.hud.say('', reason, 5, g.time);
    this.active = false;
    this.step = 'offer';
    this.timer = 0;
    if (this.passenger) {
      g.crowd.remove(this.passenger);
      this.passenger = null;
    }
  }

  /** Restore chain state from a save record. */
  restore(index) {
    this.index = Math.max(0, Math.min(MISSION_DEFS.length, index | 0));
    this.active = false;
    this.step = 'offer';
    this.replayArm = true;
    if (this.index === 2) this.ensureMarkedCar();
  }

  /** Replay the whole chain (safehouse marker after the finale). */
  replay() {
    this.index = 0;
    if (this.markedCar) {
      this.game.fleet.remove(this.markedCar);
      this.markedCar = null;
    }
  }

  /**
   * Advance the state machine. Called every sim step with the live game; uses
   * game.playerPos() for wherever Reyes is (on foot or in his car).
   */
  update(dt) {
    const g = this.game;
    const pos = g.playerPos();
    const marker = this.markerPos();
    if (!this.active) {
      if (!marker) return;
      const dist = Math.hypot(pos.x - marker.x, pos.z - marker.z);
      if (this.index >= MISSION_DEFS.length) {
        if (dist > 7) this.replayArm = true;
        else if (dist < 4.2 && this.replayArm) {
          this.replay();
          g.hud.say(MARLA, 'Back for more? Same jobs, same bay. You know the way.', 5, g.time);
        }
        return;
      }
      if (dist < 4.2) this.accept();
      return;
    }
    // mission timers
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.index === 0 && this.step === 'deliver') {
          this.fail('The buyer left. Marla: "No package, no pay. Come back to the marker and we try again."');
          return;
        }
        this.timer = 0;
      }
    }
    const at = (p, r) => Math.hypot(pos.x - p.x, pos.z - p.z) < r;
    if (this.index === 0) {
      if (this.step === 'pickup' && at(LANDMARKS.docks.at, 7)) {
        this.step = 'deliver';
        this.timer = 150;
        g.audio.pickup();
        g.hud.say('', 'Package on board. The buyer at Cafe Solana is watching the clock.', 5, g.time);
      } else if (this.step === 'deliver' && at(LANDMARKS.cafe.at, 7)) {
        g.hud.say('Buyer', 'Marla’s package, on time. Tell her the bay provides.', 4.5, g.time);
        this.complete();
      }
    } else if (this.index === 1) {
      if (this.step === 'pickup') {
        const hotel = LANDMARKS.hotel.at;
        if (at(hotel, 9)) {
          if (!g.playerCar) {
            if (!this.hintShown) {
              this.hintShown = true;
              g.hud.say('Silvio', 'You came on FOOT? Get a car, genius — I am not walking to the docks.', 4.5, g.time);
            }
          } else if (Math.hypot(g.playerCar.vx, g.playerCar.vz) < 1) {
            this.passenger.state = 'follow';
            this.passenger.targetX = g.playerCar.x;
            this.passenger.targetZ = g.playerCar.z;
            if (Math.hypot(this.passenger.x - g.playerCar.x, this.passenger.z - g.playerCar.z) < 2.4) {
              this.passenger.state = 'incar';
              this.step = 'ride';
              this.boardHealth = g.playerCar.health;
              g.hud.say('Silvio', 'Okay. Okay. Just — drive like the car is made of glass, please?', 5, g.time);
            }
          }
        }
      } else if (this.step === 'ride') {
        if (!g.playerCar) {
          this.fail('Silvio bailed out. "On foot? In THIS city? Forget it." — mission failed.');
          return;
        }
        const damage = this.boardHealth - g.playerCar.health;
        if (g.playerCar.dead || damage > 45) {
          const px = g.playerCar.x + 3;
          const pz = g.playerCar.z;
          this.passenger.state = 'idle';
          this.passenger.x = px;
          this.passenger.z = pz;
          this.passenger.mesh.position.set(px, 0.02, pz);
          this.fail('Silvio stumbled out, pale. "You drive like a demolition derby. I\'ll take my chances walking." — mission failed.');
          return;
        }
        if (at(LANDMARKS.docks.at, 9)) {
          const done = this.passenger;
          done.state = 'idle';
          done.x = LANDMARKS.docks.at.x + 2;
          done.z = LANDMARKS.docks.at.z - 2;
          done.mesh.position.set(done.x, 0.02, done.z);
          this.passenger = null;
          window.setTimeout(() => g.crowd.remove(done), 4000);
          g.hud.say('Silvio', 'Land. Beautiful, solid land. Tell Marla I owe her one.', 4.5, g.time);
          this.complete();
        }
      }
    } else if (this.index === 2) {
      if (this.step === 'steal') {
        if (g.playerCar && g.playerCar === this.markedCar) {
          this.step = 'deliver';
          g.addHeat(2, pos.x, pos.z, true);
          g.hud.say(REYES, 'One coral coupe, borrowed permanently. Now — Sal’s, before this gets loud.', 5, g.time);
        }
      } else if (this.step === 'deliver') {
        if (g.playerCar !== this.markedCar) {
          this.fail('That is not the coupe Sal is waiting for. Mission reset.');
          return;
        }
        if (at(LANDMARKS.garage.at, 9)) {
          this.markedCar.kind = 'parked';
          this.markedCar = null;
          g.hud.say('Sal', 'Coral, unscratched-ish, and hot as a stove. Marla said you were good.', 5, g.time);
          this.complete();
        }
      }
    } else if (this.index === 3) {
      if (this.step === 'escape' && at(LANDMARKS.safehouse.at, 8)) {
        g.setWanted(0);
        g.hud.say(MARLA, 'Door. Locked. Breathe. You just outran the whole MBPD, Reyes.', 5.5, g.time);
        this.complete();
      }
    }
  }
}
