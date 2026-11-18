// A tiny deterministic random number generator (mulberry32). The city, traffic and
// screenshot scenes all draw from seeded streams, so a given seed always builds the
// same Marlowe Bay and the staged screenshots render the same frame every time.

/** Create a seeded RNG: call it for a float in [0, 1). */
export function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Float in [min, max) from rng. */
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Integer in [min, max] inclusive from rng. */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick one element of arr with rng. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
