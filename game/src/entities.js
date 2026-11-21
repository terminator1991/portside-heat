// Portside Heat — the moving things: car models and factories for cars, pedestrians,
// gunmen (officers and mission thugs share one body), pickups and particles.

/**
 * Car models. topSpeed in px/s, accel in px/s^2, grip is how fast the nose follows
 * the steering. Police use the interceptor; the mission-3 target is the crimson cabrio.
 */
export const CAR_MODELS = [
  { name: 'Bantam hatchback', length: 44, width: 24, topSpeed: 305, accel: 235, grip: 3.4 },
  { name: 'Meridian sedan', length: 50, width: 25, topSpeed: 345, accel: 265, grip: 3.2 },
  { name: 'Hauler pickup', length: 52, width: 27, topSpeed: 315, accel: 240, grip: 2.8 },
  { name: 'Cabrio roadster', length: 47, width: 25, topSpeed: 395, accel: 320, grip: 3.8 },
  { name: 'Interceptor', length: 51, width: 26, topSpeed: 385, accel: 315, grip: 3.6 },
];

export const CAR_COLORS = [
  '#d94f30', '#3e7cb1', '#f2f0e6', '#454545', '#81b29a',
  '#e9c46a', '#6d6875', '#2a9d8f', '#bc6c25', '#9b5de5',
];
export const POLICE_COLOR = '#eef2f5';
export const TARGET_CAR_COLOR = '#b3001b';

let nextId = 1;

/**
 * A car. mode is 'parked', 'traffic', 'police' or 'player'. Traffic and police cars
 * carry a rail state (see world.js) while they follow the road network.
 */
export function createCar(x, y, angle, modelIndex, color, mode) {
  const model = CAR_MODELS[modelIndex];
  return {
    id: nextId++,
    x, y, angle,
    vx: 0, vy: 0,
    speed: 0,
    modelIndex, model, color, mode,
    health: 100,
    radius: model.length * 0.42,
    r: model.length * 0.42,
    rail: null,
    turning: null,
    stuckTime: 0,
    smokeTime: 0,
    driverSeat: null,
  };
}

/** A pedestrian wandering the sidewalks. state: 'walk', 'flee' or 'down'. */
export function createPed(rng, x, y) {
  return {
    id: nextId++,
    x, y, r: 9,
    health: 40,
    angle: rng.range(0, Math.PI * 2),
    speed: 0,
    walkSpeed: rng.range(38, 66),
    state: 'walk',
    rail: null,
    fleeTime: 0,
    fleeFromX: 0,
    fleeFromY: 0,
    droppedCash: false,
    shirt: rng.pick(['#e2725b', '#3e7cb1', '#f2e3c6', '#81b29a', '#e9c46a', '#9b5de5', '#f4f1e8', '#2a9d8f']),
    skin: rng.pick(['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']),
    dead: false,
  };
}

/**
 * A gunman on foot. role 'officer' works for the wanted system (arrests, shoots at
 * high stars); role 'thug' is a mission enemy who is simply hostile.
 */
export function createGunman(x, y, role) {
  return {
    id: nextId++,
    x, y, r: 10,
    angle: 0,
    health: role === 'officer' ? 70 : 60,
    role,
    state: 'hunt',
    shootCooldown: 0.8,
    burstLeft: 0,
    burstPause: 0,
    strafeDir: 1,
    strafeTime: 0,
    dead: false,
  };
}

/** A world pickup: cash, ammo or a health snack. */
export function createPickup(x, y, kind, amount) {
  return { id: nextId++, x, y, kind, amount, phase: (x * 7 + y * 13) % 6.28, dead: false };
}

/** A short-lived visual particle (spark, smoke puff, muzzle flash, cash sparkle). */
export function spawnParticle(state, x, y, kind, angle = 0, power = 1) {
  if (state.particles.length > 420) return;
  const rng = state.fxRng;
  const base = {
    x, y, kind, age: 0,
    vx: 0, vy: 0, life: 0.4, size: 3,
  };
  if (kind === 'spark') {
    const a = angle + rng.range(-0.7, 0.7);
    const s = rng.range(60, 190) * power;
    Object.assign(base, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rng.range(0.15, 0.4), size: rng.range(1.5, 3) });
  } else if (kind === 'smoke') {
    Object.assign(base, { vx: rng.range(-8, 8), vy: rng.range(-26, -12), life: rng.range(0.7, 1.4), size: rng.range(5, 10) });
  } else if (kind === 'flash') {
    Object.assign(base, { life: 0.06, size: rng.range(7, 11) });
  } else if (kind === 'sparkle') {
    const a = rng.range(0, Math.PI * 2);
    const s = rng.range(14, 46);
    Object.assign(base, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 18, life: rng.range(0.3, 0.6), size: rng.range(1.5, 2.6) });
  } else if (kind === 'puff') {
    const a = rng.range(0, Math.PI * 2);
    const s = rng.range(10, 40);
    Object.assign(base, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rng.range(0.25, 0.5), size: rng.range(3, 6) });
  }
  state.particles.push(base);
}

/** Advance all particles; smoke grows and drifts up, sparks fall back. */
export function updateParticles(state, dt) {
  const list = state.particles;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    p.age += dt;
    if (p.age >= p.life) {
      list.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === 'spark') {
      p.vx *= 0.9;
      p.vy = p.vy * 0.9 + 130 * dt;
    }
    if (p.kind === 'smoke') p.size += 9 * dt;
  }
}
