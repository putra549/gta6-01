// Marlowe Bay's fixed numbers: the city grid, the landmarks the story uses, the car
// catalogue and the wanted-level tuning. Everything else reads from here so the world
// the missions describe is the world the city builder makes.

// The street grid: two-way roads run along x = k * PITCH and z = k * PITCH for
// k in [-GRID, GRID]; city blocks of BLOCK metres sit between them, sidewalks ring
// each block, and the bay (sand, then water) lies past the south promenade.
export const PITCH = 74;
export const GRID = 3;
export const ROAD_HALF = 7; // half the road width in metres
export const BLOCK = 60; // block face size (PITCH - road - sidewalks)
export const CITY_HALF = GRID * PITCH + PITCH / 2; // 259: fence of the built city
export const BEACH_Z = 252; // sand starts here
export const WATER_Z = 276; // water starts here

// Named places, in world metres. `at` is where the player interacts (road or
// promenade edge); `block` is the city block whose landmark building stands there.
export const LANDMARKS = {
  safehouse: { name: 'Harbour View Safehouse', at: { x: -104, z: 214 }, block: [-2, 2] },
  police: { name: 'Marlowe Bay Police — Central', at: { x: -37, z: -66 }, block: [-1, -2] },
  hospital: { name: 'St. Solana Hospital', at: { x: 66, z: 37 }, block: [1, 0] },
  garage: { name: "Sal's Garage", at: { x: 185, z: -152 }, block: [2, -3] },
  docks: { name: 'Marlowe Docks — Warehouse 9', at: { x: 198, z: 240 }, block: null },
  cafe: { name: 'Cafe Solana', at: { x: 37, z: 82 }, block: [0, 1] },
  hotel: { name: 'Hotel Marlin', at: { x: -152, z: 37 }, block: [-3, 0] },
  beachlot: { name: 'Palms Beach Lot', at: { x: -60, z: 244 }, block: null },
};

// The car catalogue: one entry per buildable model. `top` is top speed in m/s,
// `accel` engine force, `grip` lateral tyre grip, `price` is flavour for the HUD.
export const CAR_TYPES = {
  sedan: { name: 'Voyager Sedan', top: 36, accel: 13.5, grip: 9, colors: [0xb8452f, 0x2f6db8, 0xc0c4cc, 0x3a3f47, 0x7a4fa3, 0x2e8b6e] },
  hatch: { name: 'Pico Hatchback', top: 31, accel: 12, grip: 10, colors: [0xe0a51f, 0x4fa33a, 0xd96c2c, 0x8899aa, 0xc23b6e] },
  pickup: { name: 'Dune Runner Pickup', top: 33, accel: 12.5, grip: 8, colors: [0x8a6f4d, 0x546e7a, 0x9c3848, 0xd8d3c3] },
  coupe: { name: 'Sirocco Coupe', top: 46, accel: 17, grip: 11, colors: [0xff6b4a, 0x22242a, 0xf2f2f2, 0x8e2fbf] },
  police: { name: 'MBPD Interceptor', top: 43, accel: 16, grip: 10.5, colors: [0xf2f2f2] },
};

// Wanted tuning: stars are a float 0..5; each crime adds heat, heat cools when no
// officer or witness has line of sight. Police strength scales with whole stars.
export const WANTED = {
  theftSeen: 1.2,
  theftUnseen: 0.35,
  pedHit: 1.5,
  pedShot: 2.2,
  shotFired: 0.45,
  policeHit: 1.6,
  carRam: 0.3,
  decayPerSecond: 0.055,
  decayDelay: 6,
};

// Player and economy constants.
export const PLAYER = {
  walkSpeed: 5.2,
  sprintSpeed: 8.6,
  radius: 0.55,
  maxHealth: 100,
  startCash: 120,
  hospitalFeeRate: 0.1,
  hospitalFeeCap: 500,
};

export const SAVE_KEY = 'marlowe-bay-save-v1';
