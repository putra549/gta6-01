[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/putra549/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/putra549/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# MARLOWE BAY

An original open-world crime game in a browser: a sunset coastal city you can cross on
foot or by car, with traffic, pedestrians, stealable cars, a five-star wanted system,
police who chase and bust you, a pistol, a four-mission story chain, and a save file.
Everything — the city of Marlowe Bay, its people, cars, names and story — is invented
for this game. Built with three.js (vendored under `game/vendor/three/`), plain static
files, no build step, no network requests, and sound synthesised live with WebAudio.

You are **Reyes**, a courier who just rolled into Marlowe Bay with an empty wallet and a
borrowed sedan. A fixer named **Marla Venn** has work for anyone who can drive: a package
run, a nervous passenger, a borrowed sports car, and one last escape. Finish the chain,
or ignore it and make your own trouble — the bay is yours.

## Play it

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Open the page in desktop Chrome, click **Start**, and click the game once to lock the
mouse. Your progress saves automatically to the browser (cash, mission, position);
**Continue** on the title screen picks it back up.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move / drive (accelerate, brake, reverse, steer) |
| Mouse | Orbit camera (pointer lock); aim the pistol |
| Shift | Sprint on foot / handbrake boost feel in a car |
| Space | Handbrake while driving |
| E | Enter / exit a car (stand by its door) |
| Mouse click | Shoot the pistol |
| R | Reload |
| Esc or P | Pause |
| M | Mute |

## What's in the world

- **The city** — a procedural grid of two-way roads with lane markings, crosswalks and
  sidewalks; blocks of lit-window buildings with collision; street lamps, palms, signs,
  a promenade, a sandy beach and the bay itself along the south edge.
- **On foot** — third-person character with an orbit camera and sprint; walk anywhere,
  cross at the lights, mind the traffic.
- **Driving** — four original car models (sedan, hatchback, pickup, sports coupe, plus
  the police interceptor livery): arcade physics with drift, handbrake, chase camera,
  damage, and engine sound pitched to speed.
- **Traffic** — AI cars that follow lanes, queue behind each other and stop for
  obstacles; parked cars you can steal — steal one in front of a cop or its owner and
  the stars come out.
- **Pedestrians** — people stroll the sidewalks, flee from speeding cars and gunfire,
  and hitting one is a crime the city notices.
- **Wanted & police** — 0–5 stars for theft, collisions, gunfire and hitting police;
  stars fade when you break line of sight. Interceptors pursue, ram, and fill a BUSTED
  meter if they pin you — get busted and you wake at the police station, fined. Health
  gone and you wake at the hospital instead, also fined.
- **Combat** — a hitscan pistol with muzzle flash, tracers, hit sparks, 12-round
  magazines and a reload.
- **Story** — an intro and four missions with objectives, map markers, timers,
  dialogue and cash rewards, then free roam (the chain can be replayed from the
  safehouse).
- **HUD** — health, cash, wanted stars, weapon and ammo, speedometer, objective line,
  subtitles, and a live minimap with roads, police blips and the mission marker.
- **Sound** — WebAudio only: engine, siren, gunshots, chimes, UI, and a laid-back
  sunset music loop. No audio files.

## Layout

- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and
  writes `dossier.json` with the vendored make.fun library.
- `game/index.html` — the page, HUD and menus; `game/src/` — the game itself, one
  module per system (`city`, `vehicles`, `people`, `player`, `police` logic inside
  `vehicles`, `missions`, `hud`, `audio`, `input`, `save`, `shots`, `main`).
- `game/vendor/three/` — three.js, vendored byte for byte.
- `screenshots/` — four real renders of the running game, staged with `?shot=` scenes.
