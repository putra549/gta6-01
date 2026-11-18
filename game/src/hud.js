// The HUD: health, cash, wanted stars, weapon and speed readouts, the objective line,
// subtitles, prompts, the BUSTED meter, and the circular minimap — a 2D canvas that
// draws the road grid, the beach, police blips, traffic dots and the mission marker
// from the live world state every frame.

import { PITCH, GRID, CITY_HALF, BEACH_Z } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.healthbar = $('healthbar');
    this.cash = $('cash');
    this.stars = $('stars');
    this.starSpans = [...this.stars.children];
    this.wantedlabel = $('wantedlabel');
    this.clock = $('clock');
    this.objective = $('objective');
    this.toast = $('toast');
    this.speedo = $('speedo');
    this.carname = $('carname');
    this.weapon = $('weapon');
    this.subtitle = $('subtitle');
    this.prompt = $('prompt');
    this.crosshair = $('crosshair');
    this.bustedwrap = $('bustedwrap');
    this.bustedfill = $('bustedfill');
    this.dmgflash = $('dmgflash');
    this.map = $('minimap').getContext('2d');
    this.subtitleUntil = 0;
    this.toastUntil = 0;
    this.lastStars = -1;
    this.lastCash = null;
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  setHealth(v) {
    this.healthbar.style.width = `${Math.max(0, Math.min(100, v))}%`;
    this.healthbar.style.filter = v < 28 ? 'hue-rotate(-30deg) saturate(2)' : '';
  }

  setCash(v) {
    if (v === this.lastCash) return;
    this.lastCash = v;
    this.cash.innerHTML = `$${v.toLocaleString('en-US')} <small>CASH</small>`;
  }

  /** Stars are a float 0..5; whole lit stars shown, the label names the level. */
  setStars(stars) {
    const lit = stars <= 0 ? 0 : Math.max(1, Math.round(stars));
    if (lit === this.lastStars) return;
    this.lastStars = lit;
    this.starSpans.forEach((span, i) => span.classList.toggle('lit', i < lit));
    this.wantedlabel.textContent = lit === 0 ? 'NO HEAT — STAY THAT WAY' : `WANTED LEVEL ${lit}`;
  }

  setClock(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    this.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  setWeapon(mag, reserve, reloading, inCar) {
    this.weapon.style.opacity = inCar ? 0.45 : 1;
    this.weapon.innerHTML = reloading
      ? 'PISTOL <span class="ammo">RELOADING…</span>'
      : `PISTOL <span class="ammo">${mag} / ${reserve}</span>`;
  }

  /** Speed in km/h while driving; pass null on foot to hide the speedometer. */
  setSpeed(kmh, carName) {
    if (kmh === null) {
      this.speedo.classList.add('hidden');
      this.carname.classList.add('hidden');
      return;
    }
    this.speedo.classList.remove('hidden');
    this.carname.classList.remove('hidden');
    this.speedo.innerHTML = `${Math.round(kmh)} <small>KM/H</small>`;
    this.carname.textContent = carName ? carName.toUpperCase() : '';
  }

  setObjective(html) {
    if (!html) {
      this.objective.classList.add('hidden');
      return;
    }
    this.objective.classList.remove('hidden');
    if (this.objective.innerHTML !== html) this.objective.innerHTML = html;
  }

  /** A dialogue line: `who` is the speaker name (or ''), shown for `seconds`. */
  say(who, text, seconds, now) {
    this.subtitle.classList.remove('hidden');
    this.subtitle.innerHTML = who ? `<span class="who">${who}:</span> ${text}` : text;
    this.subtitleUntil = now + seconds;
  }

  /** A transient centre-top message (rewards, warnings). */
  showToast(text, now) {
    this.toast.textContent = text;
    this.toast.style.opacity = 1;
    this.toastUntil = now + 2.4;
  }

  setPrompt(html) {
    if (!html) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.classList.remove('hidden');
    if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
  }

  setCrosshair(on) {
    this.crosshair.classList.toggle('hidden', !on);
  }

  /** BUSTED meter 0..1, or null to hide it. */
  setBusted(frac) {
    if (frac === null) {
      this.bustedwrap.classList.add('hidden');
      return;
    }
    this.bustedwrap.classList.remove('hidden');
    this.bustedfill.style.width = `${Math.round(frac * 100)}%`;
  }

  /** Red vignette pulse when the player takes damage. */
  flashDamage() {
    this.dmgflash.style.transition = 'none';
    this.dmgflash.style.opacity = 0.9;
    requestAnimationFrame(() => {
      this.dmgflash.style.transition = 'opacity .5s';
      this.dmgflash.style.opacity = 0;
    });
  }

  /** Per-frame housekeeping: expire subtitles and toasts. */
  update(now) {
    if (this.subtitleUntil && now > this.subtitleUntil) {
      this.subtitle.classList.add('hidden');
      this.subtitleUntil = 0;
    }
    if (this.toastUntil && now > this.toastUntil) {
      this.toast.style.opacity = 0;
      this.toastUntil = 0;
    }
  }

  /**
   * Draw the minimap. world: {player:{x,z,heading}, cars, target:{x,z}|null,
   * safehouse:{x,z}} — north-up, the whole bay on one disc.
   */
  drawMinimap(world, time) {
    const g = this.map;
    const S = 384;
    const scale = S / (CITY_HALF * 2 + 40);
    const px = (x) => (x + CITY_HALF + 20) * scale;
    const pz = (z) => (z + CITY_HALF + 20) * scale;
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#2d6f8e';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#4c5a44';
    g.fillRect(0, 0, S, pz(BEACH_Z));
    g.fillStyle = '#e8cf9e';
    g.fillRect(0, pz(BEACH_Z), S, pz(276) - pz(BEACH_Z));
    // blocks
    g.fillStyle = '#5d6d55';
    for (let i = -GRID; i < GRID; i += 1) {
      for (let j = -GRID; j < GRID; j += 1) {
        g.fillRect(px((i + 0.5) * PITCH - 30), pz((j + 0.5) * PITCH - 30), 60 * scale, 60 * scale);
      }
    }
    // roads
    g.strokeStyle = '#8f96a3';
    g.lineWidth = Math.max(2, 14 * scale);
    g.beginPath();
    for (let k = -GRID; k <= GRID; k += 1) {
      g.moveTo(px(k * PITCH), 0);
      g.lineTo(px(k * PITCH), pz(BEACH_Z));
      g.moveTo(0, pz(k * PITCH));
      g.lineTo(S, pz(k * PITCH));
    }
    g.stroke();
    // mission target: a pulsing gold ring
    if (world.target) {
      const r = 7 + Math.sin(time * 5) * 2.2;
      g.strokeStyle = '#ffd23e';
      g.lineWidth = 3.4;
      g.beginPath();
      g.arc(px(world.target.x), pz(world.target.z), r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ffd23e';
      g.beginPath();
      g.arc(px(world.target.x), pz(world.target.z), 3, 0, Math.PI * 2);
      g.fill();
    }
    // cars: traffic grey, police flashing blue/red
    for (const car of world.cars) {
      if (car.dead) continue;
      if (car.kind === 'police') {
        g.fillStyle = Math.sin(time * 9 + car.id) > 0 ? '#4d8dff' : '#ff4d4d';
        g.beginPath();
        g.arc(px(car.x), pz(car.z), 4.6, 0, Math.PI * 2);
        g.fill();
      } else if (car.kind === 'traffic') {
        g.fillStyle = 'rgba(230,230,230,0.75)';
        g.fillRect(px(car.x) - 2, pz(car.z) - 2, 4, 4);
      }
    }
    // the player arrow
    const p = world.player;
    g.save();
    g.translate(px(p.x), pz(p.z));
    g.rotate(Math.PI - p.heading); // map is north-up with +z (south) down the canvas
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#14151a';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.4, 6.4);
    g.lineTo(0, 3.4);
    g.lineTo(-5.4, 6.4);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
