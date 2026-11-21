// Portside Heat — a small seeded random generator (mulberry32). Every random choice the
// simulation makes goes through one of these, so a seed always grows the same city and
// stages the same screenshot scene.

/**
 * Create a generator from a 32-bit seed.
 * next() returns a float in [0, 1); the helpers cover the shapes the game asks for.
 */
export function createRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    /** Float in [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },
    /** Integer in [min, max], both ends included. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** One element of the array. */
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    /** True with probability p. */
    chance(p) {
      return next() < p;
    },
    /** A fresh seed drawn from this stream, for sub-generators. */
    fork() {
      return Math.floor(next() * 4294967296);
    },
  };
}
