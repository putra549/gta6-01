// The city of Marlowe Bay, built procedurally from the grid in config.js: two-way
// roads with markings and crosswalks, sidewalk-ringed blocks, lit-window buildings
// (each one a collision box), landmark buildings for the story locations, street
// lamps, palms, signs, the promenade, the beach and the bay. Returns everything the
// other systems need: colliders, sidewalk rings for pedestrians, parking spots for
// stealable cars and the landmark list.

import * as THREE from 'three';
import { PITCH, GRID, ROAD_HALF, BLOCK, CITY_HALF, BEACH_Z, WATER_Z, LANDMARKS } from './config.js';
import { randRange, randInt, pick } from './rng.js';

const SPAN = CITY_HALF * 2 + PITCH; // full ground extent, roads run a little past the fence

/** A canvas texture from a draw callback, set up for sRGB colour. */
function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/** Road surface: asphalt with edge lines and a dashed centre line. */
function roadTexture() {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#33333c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 260; i += 1) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    g.fillStyle = '#e8e4da';
    g.fillRect(4, 0, 3, h);
    g.fillRect(w - 7, 0, 3, h);
    g.fillStyle = '#f7c948';
    g.fillRect(w / 2 - 2, 12, 4, 92);
  }, 1, SPAN / 24);
}

/** Zebra crossing square for intersections. */
function crossingTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#33333c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(240,238,230,0.85)';
    for (let i = 0; i < 5; i += 1) {
      g.fillRect(10, 8 + i * 24, w - 20, 10);
      g.fillRect(8 + i * 24, 10, 10, h - 20);
    }
  });
}

/** A building facade pair: colour map (walls + dark windows) and emissive map (lit windows). */
function facadeTextures(wall, litRatio, rng) {
  const drawWindows = (g, w, h, litOnly) => {
    const cols = 6;
    const rows = 10;
    const cw = w / cols;
    const ch = h / rows;
    for (let x = 0; x < cols; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const lit = rng() < litRatio;
        if (litOnly) {
          g.fillStyle = lit ? '#ffc46b' : '#000000';
        } else {
          g.fillStyle = lit ? '#ffd9a0' : '#232733';
        }
        g.fillRect(x * cw + 4, y * ch + 5, cw - 8, ch - 10);
      }
    }
  };
  const color = canvasTexture(192, 320, (g, w, h) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, h - 26, w, 26);
    drawWindows(g, w, h, false);
  });
  const emissive = canvasTexture(192, 320, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    drawWindows(g, w, h, true);
  });
  return { color, emissive };
}

/** A sign board with the place's name, drawn on canvas. */
function signTexture(text, bg, fg) {
  return canvasTexture(512, 96, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = 5;
    g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = fg;
    g.font = 'bold 44px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

/** World position of grid node (i, j): the intersection at (i*PITCH, j*PITCH). */
export function nodeAt(i, j) {
  return { x: i * PITCH, z: j * PITCH };
}

/** True when (x, z) is on a road surface (used for spawns and crime witnesses). */
export function isOnRoad(x, z) {
  const mx = Math.abs(((x % PITCH) + PITCH * 1.5) % PITCH - PITCH / 2);
  const mz = Math.abs(((z % PITCH) + PITCH * 1.5) % PITCH - PITCH / 2);
  return mx < ROAD_HALF || mz < ROAD_HALF;
}

/**
 * Build the whole city into `scene`. Returns colliders (building AABBs), sidewalk
 * rings, parking spots, landmark world points and an update() for the water.
 */
export function buildCity(scene, rng) {
  const colliders = [];
  const sidewalkRings = [];
  const parkSpots = [];

  // --- sky, light and sea air -------------------------------------------------
  const skyGeo = new THREE.SphereGeometry(900, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x35507e) },
      mid: { value: new THREE.Color(0xff9e5e) },
      low: { value: new THREE.Color(0xffd9a0) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;' +
      'void main(){ float h = normalize(vP).y; vec3 c = h > 0.22 ? mix(mid, top, smoothstep(0.22, 0.75, h)) : mix(low, mid, smoothstep(-0.06, 0.22, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xf2a56b, 200, 700);
  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x4a3040, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.3);
  sun.position.set(90, 120, 260);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x7d9cc4, 0.5);
  fill.position.set(-140, 90, -160);
  scene.add(fill);
  // the sun itself, low over the bay
  const sunSprite = new THREE.Mesh(
    new THREE.CircleGeometry(26, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false }),
  );
  sunSprite.position.set(90, 62, 640);
  sunSprite.lookAt(0, 40, 0);
  scene.add(sunSprite);
  // a few flat sunset clouds
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffd9c2, transparent: true, opacity: 0.55, fog: false });
  for (let i = 0; i < 9; i += 1) {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(randRange(rng, 22, 46), 10, 6), cloudMat);
    cloud.scale.y = 0.22;
    cloud.position.set(randRange(rng, -600, 600), randRange(rng, 120, 190), randRange(rng, -500, 500));
    scene.add(cloud);
  }

  // --- ground, roads, crossings ----------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SPAN + 500, SPAN + 500),
    new THREE.MeshLambertMaterial({ color: 0x59684e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  const roadMatV = new THREE.MeshLambertMaterial({ map: roadTexture() });
  const roadTexH = roadTexture();
  roadTexH.center.set(0.5, 0.5);
  roadTexH.rotation = Math.PI / 2; // same markings, turned to run along X
  const roadMatH = new THREE.MeshLambertMaterial({ map: roadTexH });
  const roadGeoV = new THREE.PlaneGeometry(ROAD_HALF * 2, SPAN);
  const roadGeoH = new THREE.PlaneGeometry(SPAN, ROAD_HALF * 2);
  for (let k = -GRID; k <= GRID; k += 1) {
    const v = new THREE.Mesh(roadGeoV, roadMatV);
    v.rotation.x = -Math.PI / 2;
    v.position.set(k * PITCH, 0.02, 0);
    scene.add(v);
    const hz = new THREE.Mesh(roadGeoH, roadMatH);
    hz.rotation.x = -Math.PI / 2;
    hz.position.set(0, 0.03, k * PITCH);
    scene.add(hz);
  }
  const crossMat = new THREE.MeshLambertMaterial({ map: crossingTexture() });
  const crossGeo = new THREE.PlaneGeometry(ROAD_HALF * 2, ROAD_HALF * 2);
  for (let i = -GRID; i <= GRID; i += 1) {
    for (let j = -GRID; j <= GRID; j += 1) {
      const c = new THREE.Mesh(crossGeo, crossMat);
      c.rotation.x = -Math.PI / 2;
      c.position.set(i * PITCH, 0.045, j * PITCH);
      scene.add(c);
    }
  }

  // --- promenade, beach, water -------------------------------------------------
  const prom = new THREE.Mesh(
    new THREE.PlaneGeometry(SPAN, BEACH_Z - 230),
    new THREE.MeshLambertMaterial({ color: 0xcbb59a }),
  );
  prom.rotation.x = -Math.PI / 2;
  prom.position.set(0, 0.015, (230 + BEACH_Z) / 2);
  scene.add(prom);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(SPAN + 400, WATER_Z - BEACH_Z + 30),
    new THREE.MeshLambertMaterial({ color: 0xe8cf9e }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.01, (BEACH_Z + WATER_Z + 30) / 2);
  scene.add(sand);
  const waterTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#2d6f8e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,220,170,0.35)';
    g.lineWidth = 3;
    for (let i = 0; i < 7; i += 1) {
      g.beginPath();
      g.moveTo(0, 10 + i * 17);
      g.bezierCurveTo(w * 0.3, 4 + i * 17, w * 0.7, 16 + i * 17, w, 10 + i * 17);
      g.stroke();
    }
  }, 30, 8);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 500),
    new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.94 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.06, WATER_Z + 240);
  scene.add(water);

  // --- blocks, sidewalks, buildings --------------------------------------------
  const walkMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a4 });
  const walkGeo = new THREE.BoxGeometry(BLOCK + 5, 0.22, BLOCK + 5);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2c2c34 });
  const wallPalette = ['#c96f4a', '#b8b0a4', '#7d8ca3', '#d9a05b', '#9c6b8e', '#5f7f76', '#c4cdd6', '#a34d3f'];
  const facades = wallPalette.map((wall) => facadeTextures(wall, 0.42, rng));
  const landmarkBlocks = new Map();
  for (const key of Object.keys(LANDMARKS)) {
    const lm = LANDMARKS[key];
    if (lm.block) landmarkBlocks.set(`${lm.block[0]},${lm.block[1]}`, key);
  }
  const landmarkStyle = {
    police: { wall: '#4a5f7d', sign: ['MARLOWE BAY POLICE', '#1d2f4a', '#bcd6ff'] },
    hospital: { wall: '#e8e6e0', sign: ['ST. SOLANA HOSPITAL', '#e8e6e0', '#c22f2f'] },
    garage: { wall: '#6e5136', sign: ["SAL'S GARAGE", '#3a2a18', '#ffd23e'] },
    cafe: { wall: '#d96c4f', sign: ['CAFE SOLANA', '#7d2f1d', '#ffe9a8'] },
    hotel: { wall: '#8e5f9e', sign: ['HOTEL MARLIN', '#3c2147', '#ffb3d9'] },
    safehouse: { wall: '#5f7f76', sign: ['HARBOUR VIEW', '#27443c', '#c8ffe9'] },
  };

  for (let bx = -GRID; bx < GRID; bx += 1) {
    for (let bz = -GRID; bz < GRID; bz += 1) {
      const cx = (bx + 0.5) * PITCH;
      const cz = (bz + 0.5) * PITCH;
      const walk = new THREE.Mesh(walkGeo, walkMat);
      walk.position.set(cx, 0.11, cz);
      scene.add(walk);
      sidewalkRings.push({ cx, cz, half: BLOCK / 2 + 2.6 });
      const lmKey = landmarkBlocks.get(`${bx},${bz}`);
      if (lmKey) {
        const style = landmarkStyle[lmKey];
        const h = lmKey === 'hotel' ? 34 : 17;
        const w = 34;
        const geo = new THREE.BoxGeometry(w, h, w);
        const tex = facadeTextures(style.wall, 0.5, rng);
        const side = new THREE.MeshLambertMaterial({ map: tex.color, emissive: 0xffc46b, emissiveMap: tex.emissive, emissiveIntensity: 0.85 });
        const mesh = new THREE.Mesh(geo, [side, side, roofMat, roofMat, side, side]);
        mesh.position.set(cx, h / 2 + 0.2, cz);
        scene.add(mesh);
        colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - w / 2, maxZ: cz + w / 2 });
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(26, 4.8),
          new THREE.MeshBasicMaterial({ map: signTexture(style.sign[0], style.sign[1], style.sign[2]) }),
        );
        sign.position.set(cx, h - 3.4, cz - w / 2 - 0.15);
        sign.rotation.y = Math.PI;
        scene.add(sign);
        continue;
      }
      // ordinary block: 1-4 buildings with gaps for alleys
      const layout = pick(rng, [[1], [2, 2], [3], [2]]);
      const cells = layout.length === 1 ? [[0, 0, 46, 46]] : layout.length === 3
        ? [[-14, -14, 24, 24], [14, -12, 22, 26], [0, 15, 30, 20]]
        : [[-14, -14, 24, 24], [14, -14, 24, 24], [-14, 14, 24, 24], [14, 14, 24, 24]].slice(0, layout.length === 2 ? 2 : 4);
      for (const [ox, oz, w, d] of cells) {
        const h = randRange(rng, 9, 34) * (rng() < 0.12 ? 1.5 : 1);
        const tex = pick(rng, facades);
        const side = new THREE.MeshLambertMaterial({ map: tex.color, emissive: 0xffc46b, emissiveMap: tex.emissive, emissiveIntensity: 0.8 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, roofMat, roofMat, side, side]);
        mesh.position.set(cx + ox, h / 2 + 0.2, cz + oz);
        scene.add(mesh);
        colliders.push({ minX: cx + ox - w / 2, maxX: cx + ox + w / 2, minZ: cz + oz - d / 2, maxZ: cz + oz + d / 2 });
        if (rng() < 0.4) {
          const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 1.6, d * 0.4), roofMat);
          cap.position.set(cx + ox, h + 1, cz + oz);
          scene.add(cap);
        }
      }
    }
  }

  // --- street lamps (instanced) --------------------------------------------------
  const lampPositions = [];
  for (let k = -GRID; k <= GRID; k += 1) {
    for (let s = -3; s <= 3; s += 1) {
      const along = s * PITCH * 0.5 + (k % 2 === 0 ? 18 : -18);
      lampPositions.push([k * PITCH + ROAD_HALF + 1.2, along]);
      lampPositions.push([along, k * PITCH - ROAD_HALF - 1.2]);
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampPositions.length);
  const headGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampPositions.length);
  const m4 = new THREE.Matrix4();
  lampPositions.forEach(([x, z], i) => {
    m4.makeTranslation(x, 2.8, z);
    poles.setMatrixAt(i, m4);
    m4.makeTranslation(x, 5.7, z);
    heads.setMatrixAt(i, m4);
  });
  scene.add(poles);
  scene.add(heads);

  // --- palms along the promenade and scattered in the city -----------------------
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.4, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
  const crownGeo = new THREE.ConeGeometry(2.6, 1.5, 7);
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x3f7d3a });
  const palmAt = (x, z) => {
    const tilt = randRange(rng, -0.09, 0.09);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 2.7, z);
    trunk.rotation.z = tilt;
    scene.add(trunk);
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.position.set(x + tilt * -5, 5.6, z);
    crown.rotation.x = Math.PI;
    scene.add(crown);
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 });
  };
  for (let x = -CITY_HALF + 12; x < CITY_HALF; x += 24) palmAt(x + randRange(rng, -4, 4), BEACH_Z - 6 + randRange(rng, -2, 2));
  for (let i = 0; i < 26; i += 1) {
    const ring = pick(rng, sidewalkRings);
    palmAt(ring.cx + randRange(rng, -1, 1) * (ring.half - 3), ring.cz + (rng() < 0.5 ? -1 : 1) * (ring.half - 3));
  }

  // --- a welcome sign at the east entrance ---------------------------------------
  const welcome = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 5.6),
    new THREE.MeshBasicMaterial({ map: signTexture('MARLOWE BAY', '#27443c', '#ffe9a8'), side: THREE.DoubleSide }),
  );
  welcome.position.set(CITY_HALF - 6, 7, 10);
  welcome.rotation.y = -Math.PI / 2;
  scene.add(welcome);

  // --- parking spots: stealable cars along road edges ------------------------------
  const parkHeadings = [];
  for (let i = 0; i < 22; i += 1) {
    const vertical = rng() < 0.5;
    const line = randInt(rng, -GRID, GRID) * PITCH;
    const along = randRange(rng, -CITY_HALF + 30, CITY_HALF - 30);
    const side = rng() < 0.5 ? -1 : 1;
    if (vertical) {
      parkSpots.push({ x: line + side * (ROAD_HALF - 1.7), z: along, heading: side > 0 ? 0 : Math.PI });
    } else {
      parkSpots.push({ x: along, z: line + side * (ROAD_HALF - 1.7), heading: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
    parkHeadings.push(i);
  }
  // the promenade lot by the beach (the story's coupe waits here, placed by missions)
  parkSpots.push({ x: -72, z: 246, heading: Math.PI / 2 });
  parkSpots.push({ x: -84, z: 246, heading: Math.PI / 2 });

  return {
    colliders,
    sidewalkRings,
    parkSpots,
    update(dt, t) {
      waterTex.offset.x = (t * 0.008) % 1;
      waterTex.offset.y = Math.sin(t * 0.24) * 0.02;
      water.position.y = 0.06 + Math.sin(t * 0.5) * 0.03;
    },
  };
}

/** Push a circle (x, z, r) out of every AABB collider; returns corrected [x, z] and hit strength. */
export function collideCircle(colliders, x, z, r) {
  let hit = 0;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * r;
        z = nz + (dz / d) * r;
      } else {
        // centre inside the box: leave by the nearest face
        const left = x - c.minX;
        const right = c.maxX - x;
        const top = z - c.minZ;
        const bottom = c.maxZ - z;
        const min = Math.min(left, right, top, bottom);
        if (min === left) x = c.minX - r;
        else if (min === right) x = c.maxX + r;
        else if (min === top) z = c.minZ - r;
        else z = c.maxZ + r;
      }
      hit = 1;
    }
  }
  return { x, z, hit };
}
