// Portside Heat — the simulation: one state, one fixed-step update. The player on
// foot and in cars, traffic and crowds, combat, the wanted system and its police,
// pickups, the mission runner, the day cycle and the camera. main.js owns the
// screens; this file owns the world while it is being played.

import {
  STEP, CITY_SEED, PLAYER_RADIUS, PLAYER_WALK_SPEED, PLAYER_SPRINT_SPEED,
  PLAYER_MAX_HEALTH, PLAYER_START_CASH, PLAYER_DEBT, STAR_THRESHOLDS, CRIME_POINTS,
  HIDE_SECONDS, WANTED_DECAY, PISTOL_DAMAGE, PISTOL_MAGAZINE, PISTOL_FIRE_INTERVAL,
  PISTOL_RELOAD_SECONDS, BULLET_SPEED, BULLET_RANGE, MELEE_DAMAGE, MELEE_RANGE,
  ENEMY_BULLET_DAMAGE, DAY_LENGTH, DAY_START, AVENUES, STREETS,
} from './config.js';
import { createRandom } from './random.js';
import {
  createWorld, moveCircle, circleBlocked, lineOfSightClear,
  randomLaneSpawn, railPosition, parkingSpots,
} from './world.js';
import {
  CAR_MODELS, CAR_COLORS, POLICE_COLOR, TARGET_CAR_COLOR,
  createCar, createPed, createGunman, createPickup, spawnParticle, updateParticles,
} from './entities.js';
import {
  updateTrafficCar, updatePoliceCar, updatePed, updateGunman,
  driveCarPhysics, scarePedsNear, shortestAngle,
} from './ai.js';
import { MISSIONS, nextJobHint, courierJob } from './missions.js';

export const EVENT_BUSTED = 1;
export const EVENT_WASTED = 2;
export const EVENT_STORY_DONE = 4;

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function starsForPoints(points) {
  let stars = 0;
  for (let i = 0; i < STAR_THRESHOLDS.length; i += 1) {
    if (points >= STAR_THRESHOLDS[i]) stars = i;
  }
  return stars;
}

/** Create the whole game state for a seed and populate the city. */
export function createGame(seed = CITY_SEED) {
  const world = createWorld(createRandom(seed));
  const simRng = createRandom((seed ^ 0x85ebca6b) >>> 0);
  const state = {
    world,
    simRng,
    fxRng: createRandom((seed ^ 0x27d4eb2f) >>> 0),
    time: 0,
    dayTime: DAY_START,
    viewW: 1280,
    viewH: 720,
    player: {
      x: world.landmarks.hideout.x, y: world.landmarks.hideout.y + 30,
      r: PLAYER_RADIUS, angle: 0, vx: 0, vy: 0,
      health: PLAYER_MAX_HEALTH, cash: PLAYER_START_CASH,
      mag: PISTOL_MAGAZINE, reserve: 36,
      reloading: 0, fireCooldown: 0, meleeCooldown: 0,
      inCar: false, bustedMeter: 0, hiddenTime: 0,
    },
    playerCar: null,
    cars: [],
    peds: [],
    gunmen: [],
    bullets: [],
    pickups: [],
    particles: [],
    wanted: { points: 0, stars: 0, seen: false },
    camera: { x: world.landmarks.hideout.x, y: world.landmarks.hideout.y },
    mission: {
      phase: 'idle', index: 0, stageIndex: 0, stage: null,
      timer: null, wave: 0, wavePause: 0, carrying: false,
      targetCar: null, courier: null, guardsSpawned: false,
    },
    dialogue: null,
    dialogueDone: null,
    objective: null,
    toast: null,
    shake: 0,
    storyDone: false,
    debt: PLAYER_DEBT,
    stats: { earned: 0, stolen: 0, missionsDone: 0, shots: 0, takedowns: 0, arrests: 0, deaths: 0 },
    audio: null,
    policeSpawnCooldown: 0,
    officerSpawnCooldown: 0,
    lastShotCrimeAt: -10,
    endKind: null,
  };
  state.reportCrime = (kind, x, y) => reportCrime(state, kind, x, y);
  populateCity(state);
  return {
    state,
    step: (dt, input) => stepGame(state, dt, input),
    newGame: () => resetProgress(state),
    applySave: (data) => applySave(state, data),
    makeSave: () => makeSave(state),
    respawn: (kind) => respawn(state, kind),
  };
}

/** Parked cars, moving traffic and a wandering crowd. */
function populateCity(state) {
  const rng = state.simRng;
  const world = state.world;
  for (const spot of parkingSpots(world, rng)) {
    if (!rng.chance(0.62)) continue;
    const modelIndex = rng.chance(0.08) ? 3 : rng.int(0, 2);
    state.cars.push(createCar(spot.x, spot.y, spot.angle, modelIndex, rng.pick(CAR_COLORS), 'parked'));
  }
  for (let i = 0; i < 16; i += 1) spawnTrafficCar(state, null);
  for (let i = 0; i < 44; i += 1) {
    const ped = createPed(rng, 0, 0);
    placePedOnSidewalk(state, ped);
    state.peds.push(ped);
  }
}

function placePedOnSidewalk(state, ped) {
  const rng = state.simRng;
  if (rng.chance(0.5)) {
    const index = rng.int(0, AVENUES.length - 1);
    ped.rail = { rail: 'avenue', index, side: rng.chance(0.5) ? -1 : 1, dir: rng.chance(0.5) ? 1 : -1, pos: rng.range(60, state.world.height - 60) };
    ped.x = AVENUES[index] + ped.rail.side * 81;
    ped.y = ped.rail.pos;
  } else {
    const index = rng.int(0, STREETS.length - 1);
    ped.rail = { rail: 'street', index, side: rng.chance(0.5) ? -1 : 1, dir: rng.chance(0.5) ? 1 : -1, pos: rng.range(60, 2900) };
    ped.x = ped.rail.pos;
    ped.y = STREETS[index] + ped.rail.side * 81;
  }
}

/** Spawn a traffic car on a lane; near the player when a target point is given. */
function spawnTrafficCar(state, nearPlayer) {
  const rng = state.simRng;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const spawn = randomLaneSpawn(rng);
    const p = railPosition(spawn);
    if (nearPlayer) {
      const d = Math.hypot(p.x - state.player.x, p.y - state.player.y);
      if (d < 640 || d > 1150) continue;
    }
    if (circleBlocked(state.world, p.x, p.y, 26)) continue;
    const car = createCar(p.x, p.y, 0, rng.int(0, 2), rng.pick(CAR_COLORS), 'traffic');
    car.rail = spawn;
    car.cruiseSpeed = rng.range(118, 172);
    car.angle = spawn.rail === 'avenue' ? (spawn.dir > 0 ? Math.PI : 0) : (spawn.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    state.cars.push(car);
    return car;
  }
  return null;
}

/** Spawn a police car on a lane ring around the player. */
function spawnPoliceCar(state) {
  const rng = state.simRng;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const spawn = randomLaneSpawn(rng);
    const p = railPosition(spawn);
    const d = Math.hypot(p.x - state.player.x, p.y - state.player.y);
    if (d < 620 || d > 980) continue;
    const car = createCar(p.x, p.y, 0, 4, POLICE_COLOR, 'police');
    car.rail = spawn;
    car.angle = spawn.rail === 'avenue' ? (spawn.dir > 0 ? Math.PI : 0) : (spawn.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    state.cars.push(car);
    return car;
  }
  return null;
}

/**
 * Report a crime: it only raises the wanted level when someone saw it — a pedestrian
 * or officer with line of sight, or a police car close by.
 */
export function reportCrime(state, kind, x, y) {
  let witnessed = false;
  for (const ped of state.peds) {
    if (ped.dead) continue;
    if (dist2(ped.x, ped.y, x, y) < 300 * 300 && lineOfSightClear(state.world, ped.x, ped.y, x, y)) { witnessed = true; break; }
  }
  if (!witnessed) {
    for (const g of state.gunmen) {
      if (g.dead || g.role !== 'officer') continue;
      if (dist2(g.x, g.y, x, y) < 330 * 330 && lineOfSightClear(state.world, g.x, g.y, x, y)) { witnessed = true; break; }
    }
  }
  if (!witnessed) {
    for (const car of state.cars) {
      if (car.mode !== 'police') continue;
      if (dist2(car.x, car.y, x, y) < 210 * 210) { witnessed = true; break; }
    }
  }
  if (!witnessed) return false;
  state.wanted.points = Math.min(980, state.wanted.points + (CRIME_POINTS[kind] ?? 20));
  state.wanted.stars = starsForPoints(state.wanted.points);
  return true;
}

/** The one update. Returns an EVENT_* bitmask for the screen layer. */
function stepGame(state, dt, input) {
  state.time += dt;
  state.dayTime = (state.dayTime + dt / DAY_LENGTH) % 1;
  let events = 0;

  if (state.dialogue) {
    updateAmbient(state, dt);
    if (input.confirmPressed || input.interactPressed) advanceDialogue(state);
    updateCamera(state, dt);
    return events;
  }

  updatePlayer(state, dt, input);
  updateCars(state, dt, input);
  for (const ped of state.peds) updatePed(state, ped, dt);
  for (const g of state.gunmen) updateGunman(state, g, dt);
  updateBullets(state, dt);
  updatePickups(state, dt);
  updateWanted(state, dt);
  managePolice(state, dt);
  events |= updateMissions(state, dt);
  updateParticles(state, dt);
  updateCamera(state, dt);
  if (state.toast) {
    state.toast.t -= dt;
    if (state.toast.t <= 0) state.toast = null;
  }
  state.shake = Math.max(0, state.shake - dt * 26);

  if (state.player.health <= 0 && !state.player.inCar) {
    state.endKind = 'wasted';
    events |= EVENT_WASTED;
  } else if (state.player.bustedMeter >= 1) {
    state.endKind = 'busted';
    events |= EVENT_BUSTED;
  }
  return events;
}

/** Traffic, crowds and particles keep moving behind dialogue. */
function updateAmbient(state, dt) {
  for (const car of state.cars) if (car.mode === 'traffic') updateTrafficCar(state, car, dt);
  for (const ped of state.peds) updatePed(state, ped, dt);
  updateParticles(state, dt);
}

/** Show a line of dialogue; onDone runs when the last line is dismissed. */
function startDialogue(state, lines, onDone) {
  state.dialogue = { lines, index: 0 };
  state.dialogueDone = onDone;
}

function advanceDialogue(state) {
  state.dialogue.index += 1;
  if (state.dialogue.index >= state.dialogue.lines.length) {
    state.dialogue = null;
    const done = state.dialogueDone;
    state.dialogueDone = null;
    if (done) done();
  }
}

function toast(state, text, seconds = 3.4) {
  state.toast = { text, t: seconds };
}

/* ---------------- the player ---------------- */

function updatePlayer(state, dt, input) {
  const player = state.player;
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  player.meleeCooldown = Math.max(0, player.meleeCooldown - dt);
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      const take = Math.min(PISTOL_MAGAZINE - player.mag, player.reserve);
      player.mag += take;
      player.reserve -= take;
    }
  }

  if (player.inCar) {
    const car = state.playerCar;
    if (!car || car.mode === 'wrecked') {
      exitCar(state, true);
      return;
    }
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    if (input.interactPressed) {
      exitCar(state, false);
      return;
    }
    // Reckless driving near crowds is itself a small crime and a big scare.
    if (Math.abs(car.speed) > 285) {
      scarePedsNear(state, car.x, car.y, 105, false);
      if (state.time - (car.lastRecklessAt ?? -9) > 3) {
        car.lastRecklessAt = state.time;
        reportCrime(state, 'reckless', car.x, car.y);
      }
    }
    return;
  }

  // On foot.
  const speed = input.sprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
  let tx = input.moveX;
  let ty = input.moveY;
  const len = Math.hypot(tx, ty);
  if (len > 0) {
    tx = (tx / len) * speed;
    ty = (ty / len) * speed;
  }
  const blend = 1 - Math.exp(-14 * dt);
  player.vx += (tx - player.vx) * blend;
  player.vy += (ty - player.vy) * blend;
  moveCircle(state.world, player, player.vx * dt, player.vy * dt);

  const aiming = input.shootHeld || input.attackPressed;
  if (aiming) {
    player.angle = Math.atan2(input.aimX - player.x, -(input.aimY - player.y));
  } else if (len > 0) {
    player.angle = Math.atan2(player.vx, -player.vy);
  }

  if (input.attackPressed && player.meleeCooldown <= 0) meleeAttack(state);
  if (input.reloadPressed) startReload(state);
  if (input.shootHeld && player.fireCooldown <= 0 && player.reloading <= 0) shootPistol(state, input);
  if (input.interactPressed) tryEnterCar(state);
}

function startReload(state) {
  const player = state.player;
  if (player.mag < PISTOL_MAGAZINE && player.reserve > 0 && player.reloading <= 0) {
    player.reloading = PISTOL_RELOAD_SECONDS;
  }
}

function shootPistol(state, input) {
  const player = state.player;
  if (player.mag <= 0) {
    player.fireCooldown = 0.3;
    if (state.audio) state.audio.denied();
    startReload(state);
    return;
  }
  player.mag -= 1;
  player.fireCooldown = PISTOL_FIRE_INTERVAL;
  state.stats.shots += 1;
  const angle = Math.atan2(input.aimX - player.x, -(input.aimY - player.y));
  state.bullets.push({
    x: player.x + Math.sin(angle) * 16,
    y: player.y - Math.cos(angle) * 16,
    vx: Math.sin(angle) * BULLET_SPEED,
    vy: -Math.cos(angle) * BULLET_SPEED,
    angle, fromPlayer: true, travelled: 0, dead: false,
  });
  spawnParticle(state, player.x + Math.sin(angle) * 18, player.y - Math.cos(angle) * 18, 'flash');
  scarePedsNear(state, player.x, player.y, 250, true);
  if (state.time - state.lastShotCrimeAt > 1.6) {
    state.lastShotCrimeAt = state.time;
    reportCrime(state, 'gunshot', player.x, player.y);
  }
  if (state.audio) state.audio.shot();
  if (player.mag === 0) startReload(state);
}

function meleeAttack(state) {
  const player = state.player;
  player.meleeCooldown = 0.38;
  if (state.audio) state.audio.punch();
  const range = MELEE_RANGE + 12;
  const hitSomething = (target, isOfficer) => {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    if (dx * dx + dy * dy > range * range) return false;
    const dir = Math.atan2(dx, -dy);
    if (Math.abs(shortestAngle(dir - player.angle)) > 1.15) return false;
    return true;
  };
  for (const g of state.gunmen) {
    if (g.dead || !hitSomething(g)) continue;
    damageGunman(state, g, MELEE_DAMAGE, true);
    return;
  }
  for (const ped of state.peds) {
    if (ped.dead || !hitSomething(ped)) continue;
    ped.health -= MELEE_DAMAGE;
    scarePedsNear(state, ped.x, ped.y, 150, true);
    if (ped.health <= 0) {
      ped.dead = true;
      reportCrime(state, 'killPedestrian', ped.x, ped.y);
    } else {
      reportCrime(state, 'assault', ped.x, ped.y);
    }
    return;
  }
}

function tryEnterCar(state) {
  const player = state.player;
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (car.mode === 'wrecked') continue;
    const d = dist2(car.x, car.y, player.x, player.y);
    const reach = (car.radius + 30) * (car.radius + 30);
    if (d < reach && d < bestD) {
      best = car;
      bestD = d;
    }
  }
  if (!best) return;
  const wasPolice = best.mode === 'police';
  const wasTraffic = best.mode === 'traffic';
  best.mode = 'player';
  best.rail = null;
  best.turning = null;
  best.vx = 0;
  best.vy = 0;
  best.speed = 0;
  player.inCar = true;
  state.playerCar = best;
  player.x = best.x;
  player.y = best.y;
  if (!best.stolenCounted) {
    best.stolenCounted = true;
    state.stats.stolen += 1;
    reportCrime(state, 'theft', best.x, best.y);
    if (wasPolice) state.wanted.points = Math.min(980, state.wanted.points + 50);
    if (wasTraffic) scarePedsNear(state, best.x, best.y, 120, false);
  }
}

function exitCar(state, forced) {
  const player = state.player;
  const car = state.playerCar;
  if (!car) {
    player.inCar = false;
    return;
  }
  if (car.mode === 'player') car.mode = 'parked';
  car.vx = 0;
  car.vy = 0;
  car.speed = 0;
  const side = state.simRng.chance(0.5) ? 1 : -1;
  const offsets = [
    { x: car.x + Math.cos(car.angle) * side * (car.radius + 18), y: car.y + Math.sin(car.angle) * side * (car.radius + 18) },
    { x: car.x - Math.cos(car.angle) * side * (car.radius + 18), y: car.y - Math.sin(car.angle) * side * (car.radius + 18) },
    { x: car.x, y: car.y + car.radius + 18 },
  ];
  for (const spot of offsets) {
    if (!circleBlocked(state.world, spot.x, spot.y, player.r)) {
      player.x = spot.x;
      player.y = spot.y;
      break;
    }
  }
  player.inCar = false;
  state.playerCar = null;
  player.bustedMeter = 0;
  if (forced) toast(state, 'The car is wrecked — out!', 2.4);
}

/* ---------------- cars ---------------- */

function updateCars(state, dt, input) {
  const player = state.player;
  for (const car of state.cars) {
    if (car.mode === 'traffic') updateTrafficCar(state, car, dt);
    else if (car.mode === 'police') {
      updatePoliceCar(state, car, dt);
      if (car.health <= 0 && car.mode !== 'wrecked') wreckCar(state, car);
    } else if (car.mode === 'player' && state.playerCar === car) {
      const throttle = -input.moveY;
      const steer = input.moveX;
      const impact = driveCarPhysics(state, car, throttle, steer, input.handbrake, dt);
      if (impact > 120) {
        const fx = car.x + Math.sin(car.angle) * car.radius;
        const fy = car.y - Math.cos(car.angle) * car.radius;
        for (let i = 0; i < 5; i += 1) spawnParticle(state, fx, fy, 'spark', car.angle + Math.PI, 1);
        car.health -= (impact - 105) * 0.11;
        state.shake = Math.min(9, (impact - 100) * 0.05);
        if (state.audio) state.audio.crash(Math.min(1, impact / 320));
        if (car.health <= 0) wreckCar(state, car);
      }
      if (car.health < 55 && state.simRng.chance(0.25)) {
        spawnParticle(state, car.x, car.y - 6, 'smoke');
      }
      // Tyre smoke pours off the rear wheels when the handbrake bites at speed.
      if (input.handbrake && Math.abs(car.speed) > 130 && state.simRng.chance(0.6)) {
        spawnParticle(
          state,
          car.x - Math.sin(car.angle) * 18, car.y + Math.cos(car.angle) * 18,
          'smoke',
        );
      }
    }
    // Distant traffic recycles to lanes near the player so the city stays alive.
    if (car.mode === 'traffic') {
      const d = Math.hypot(car.x - player.x, car.y - player.y);
      if (d > 1600) {
        const fresh = spawnTrafficCar(state, true);
        if (fresh) {
          car.mode = 'gone';
        }
      }
    }
  }
  state.cars = state.cars.filter((car) => car.mode !== 'gone');
  resolveCarCollisions(state, dt);
  // Keep the traffic population topped up after thefts and recycling.
  const trafficCount = state.cars.filter((car) => car.mode === 'traffic').length;
  if (trafficCount < 15 && state.simRng.chance(0.02)) spawnTrafficCar(state, true);
}

function wreckCar(state, car) {
  car.mode = 'wrecked';
  car.vx = 0;
  car.vy = 0;
  car.speed = 0;
  for (let i = 0; i < 8; i += 1) spawnParticle(state, car.x, car.y, 'smoke');
  if (state.playerCar === car) exitCar(state, true);
}

/** Circle collisions between every pair of cars, plus running over pedestrians. */
function resolveCarCollisions(state, dt) {
  const cars = state.cars;
  for (let i = 0; i < cars.length; i += 1) {
    const a = cars[i];
    for (let j = i + 1; j < cars.length; j += 1) {
      const b = cars[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDist = a.radius + b.radius - 6;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minDist * minDist || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const aMovable = a.mode !== 'parked' && a.mode !== 'wrecked';
      const bMovable = b.mode !== 'parked' && b.mode !== 'wrecked';
      const share = aMovable && bMovable ? 0.5 : 1;
      const overlap = (minDist - d) * share;
      if (aMovable) { a.x -= nx * overlap; a.y -= ny * overlap; }
      if (bMovable) { b.x += nx * overlap; b.y += ny * overlap; }
      const relV = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relV < -40) {
        const damage = (-relV - 30) * 0.09;
        a.health -= damage * 0.7;
        b.health -= damage * 0.7;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        for (let k = 0; k < 3; k += 1) spawnParticle(state, midX, midY, 'spark', Math.atan2(nx, -ny), 0.8);
        const playerInvolved = state.playerCar === a || state.playerCar === b;
        const policeInvolved = a.mode === 'police' || b.mode === 'police';
        if (playerInvolved) {
          if (state.audio) state.audio.crash(Math.min(1, -relV / 300));
          state.shake = Math.min(8, -relV * 0.03);
          if (policeInvolved) {
            const other = state.playerCar === a ? b : a;
            if (state.time - (other.lastHitCrimeAt ?? -9) > 1.2) {
              other.lastHitCrimeAt = state.time;
              reportCrime(state, 'hitPoliceCar', other.x, other.y);
            }
          }
        }
        const bounce = -relV * 0.3;
        if (aMovable) { a.vx -= nx * bounce; a.vy -= ny * bounce; }
        if (bMovable) { b.vx += nx * bounce; b.vy += ny * bounce; }
        if (a.health <= 0 && a.mode !== 'wrecked') wreckCar(state, a);
        if (b.health <= 0 && b.mode !== 'wrecked') wreckCar(state, b);
      }
    }
  }
  // Cars versus people.
  for (const car of cars) {
    if (Math.abs(car.speed) < 60 && car.mode !== 'traffic') continue;
    if (car.mode === 'parked' || car.mode === 'wrecked' || car.mode === 'gone') continue;
    for (const ped of state.peds) {
      if (ped.dead) continue;
      if (dist2(ped.x, ped.y, car.x, car.y) < (car.radius + 4) * (car.radius + 4)) {
        ped.dead = true;
        spawnParticle(state, ped.x, ped.y, 'puff');
        if (car === state.playerCar) {
          reportCrime(state, 'killPedestrian', ped.x, ped.y);
          state.shake = Math.min(7, state.shake + 3);
        }
      }
    }
    // A moving car can run down a gunman, too.
    for (const g of state.gunmen) {
      if (g.dead) continue;
      if (dist2(g.x, g.y, car.x, car.y) < (car.radius + 4) * (car.radius + 4) && Math.abs(car.speed) > 130) {
        damageGunman(state, g, 200, false);
      }
    }
  }
}

/* ---------------- combat ---------------- */

function damageGunman(state, g, amount, byMelee) {
  g.health -= amount;
  if (g.health > 0 || g.dead) return;
  g.dead = true;
  state.stats.takedowns += 1;
  spawnParticle(state, g.x, g.y, 'puff');
  if (g.role === 'officer') {
    reportCrime(state, 'killOfficer', g.x, g.y);
  } else if (state.simRng.chance(0.55)) {
    state.pickups.push(createPickup(g.x, g.y, state.simRng.chance(0.6) ? 'cash' : 'ammo', state.simRng.int(15, 45)));
  }
}

function updateBullets(state, dt) {
  const player = state.player;
  for (const bullet of state.bullets) {
    if (bullet.dead) continue;
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.travelled += BULLET_SPEED * dt;
    if (bullet.travelled > BULLET_RANGE) {
      bullet.dead = true;
      continue;
    }
    let blocked = false;
    for (const b of state.world.buildings) {
      if (bullet.x > b.x && bullet.x < b.x + b.w && bullet.y > b.y && bullet.y < b.y + b.h) { blocked = true; break; }
    }
    if (blocked) {
      bullet.dead = true;
      spawnParticle(state, bullet.x, bullet.y, 'spark', bullet.angle + Math.PI, 0.5);
      continue;
    }
    if (bullet.fromPlayer) {
      let consumed = false;
      for (const g of state.gunmen) {
        if (g.dead) continue;
        if (dist2(bullet.x, bullet.y, g.x, g.y) < 13 * 13) {
          damageGunman(state, g, PISTOL_DAMAGE, false);
          if (g.role === 'officer') reportCrime(state, 'shootOfficer', g.x, g.y);
          consumed = true;
          break;
        }
      }
      if (!consumed) {
        for (const ped of state.peds) {
          if (ped.dead) continue;
          if (dist2(bullet.x, bullet.y, ped.x, ped.y) < 12 * 12) {
            ped.health -= PISTOL_DAMAGE;
            scarePedsNear(state, ped.x, ped.y, 170, true);
            if (ped.health <= 0) {
              ped.dead = true;
              reportCrime(state, 'killPedestrian', ped.x, ped.y);
            } else {
              reportCrime(state, 'assault', ped.x, ped.y);
            }
            consumed = true;
            break;
          }
        }
      }
      if (!consumed) {
        for (const car of state.cars) {
          if (car === state.playerCar) continue;
          if (dist2(bullet.x, bullet.y, car.x, car.y) < car.radius * car.radius) {
            car.health -= PISTOL_DAMAGE * 0.5;
            spawnParticle(state, bullet.x, bullet.y, 'spark', bullet.angle + Math.PI, 0.7);
            if (car.mode === 'police') reportCrime(state, 'hitPoliceCar', car.x, car.y);
            if (car.health <= 0 && car.mode !== 'wrecked') wreckCar(state, car);
            consumed = true;
            break;
          }
        }
      }
      if (consumed) bullet.dead = true;
    } else {
      // Enemy bullets: the player's car soaks them; on foot they hit the player.
      if (player.inCar && state.playerCar) {
        const car = state.playerCar;
        if (dist2(bullet.x, bullet.y, car.x, car.y) < car.radius * car.radius) {
          car.health -= 4;
          spawnParticle(state, bullet.x, bullet.y, 'spark', bullet.angle + Math.PI, 0.6);
          if (car.health <= 0) wreckCar(state, car);
          bullet.dead = true;
        }
      } else if (dist2(bullet.x, bullet.y, player.x, player.y) < (player.r + 2) * (player.r + 2)) {
        player.health -= ENEMY_BULLET_DAMAGE;
        spawnParticle(state, player.x, player.y, 'puff');
        state.shake = Math.min(6, state.shake + 1.6);
        bullet.dead = true;
      }
    }
  }
  state.bullets = state.bullets.filter((b) => !b.dead);
}

function updatePickups(state, dt) {
  const player = state.player;
  for (const pickup of state.pickups) {
    pickup.phase += dt * 3;
    if (pickup.dead) continue;
    const reach = player.inCar ? 40 : 26;
    if (dist2(pickup.x, pickup.y, player.x, player.y) > reach * reach) continue;
    pickup.dead = true;
    if (pickup.kind === 'cash') {
      player.cash += pickup.amount;
      for (let i = 0; i < 4; i += 1) spawnParticle(state, pickup.x, pickup.y, 'sparkle');
    } else if (pickup.kind === 'ammo') {
      player.reserve += 24;
      toast(state, '+24 pistol rounds', 1.6);
    } else if (pickup.kind === 'health') {
      player.health = Math.min(PLAYER_MAX_HEALTH, player.health + 30);
      toast(state, '+30 health — street food works wonders', 1.8);
    }
    if (state.audio) state.audio.pickup();
  }
  state.pickups = state.pickups.filter((p) => !p.dead);
}

/* ---------------- wanted & police ---------------- */

function updateWanted(state, dt) {
  const player = state.player;
  const wanted = state.wanted;
  let seen = false;
  for (const car of state.cars) {
    if (car.mode !== 'police') continue;
    if (dist2(car.x, car.y, player.x, player.y) < 430 * 430
      && lineOfSightClear(state.world, car.x, car.y, player.x, player.y)) { seen = true; break; }
  }
  if (!seen) {
    for (const g of state.gunmen) {
      if (g.dead || g.role !== 'officer') continue;
      if (dist2(g.x, g.y, player.x, player.y) < 340 * 340
        && lineOfSightClear(state.world, g.x, g.y, player.x, player.y)) { seen = true; break; }
    }
  }
  wanted.seen = seen;
  if (seen) player.hiddenTime = 0;
  else player.hiddenTime += dt;
  if (player.hiddenTime > HIDE_SECONDS && wanted.points > 0) {
    wanted.points = Math.max(0, wanted.points - WANTED_DECAY * dt);
    wanted.stars = starsForPoints(wanted.points);
  }
  // The arrest: an officer holding close range on foot, or a boxed-in stopped car.
  let pressure = 0;
  if (!player.inCar) {
    for (const g of state.gunmen) {
      if (g.dead || g.role !== 'officer') continue;
      if (dist2(g.x, g.y, player.x, player.y) < 46 * 46
        && lineOfSightClear(state.world, g.x, g.y, player.x, player.y)) { pressure = 1; break; }
    }
  } else if (state.playerCar && Math.abs(state.playerCar.speed) < 16) {
    let near = 0;
    for (const car of state.cars) {
      if (car.mode === 'police' && dist2(car.x, car.y, player.x, player.y) < 78 * 78) near += 1;
    }
    if (near >= 2) pressure = 1;
  }
  if (wanted.stars === 0) pressure = 0;
  if (pressure) player.bustedMeter = Math.min(1, player.bustedMeter + dt / 1.7);
  else player.bustedMeter = Math.max(0, player.bustedMeter - dt * 0.55);
}

function managePolice(state, dt) {
  const stars = state.wanted.stars;
  state.policeSpawnCooldown -= dt;
  state.officerSpawnCooldown -= dt;
  const policeCars = state.cars.filter((car) => car.mode === 'police');
  const officers = state.gunmen.filter((g) => g.role === 'officer' && !g.dead);

  if (stars === 0) {
    // The heat is off: patrols melt back into traffic, officers walk away.
    for (const car of policeCars) {
      car.mode = 'traffic';
      car.rail = nearestRail(state, car);
      car.cruiseSpeed = 140;
      car.turning = null;
    }
    for (const g of officers) g.role = 'leaving';
    state.gunmen = state.gunmen.filter((g) => g.role !== 'leaving'
      || Math.hypot(g.x - state.player.x, g.y - state.player.y) < 700);
    return;
  }
  const desiredCars = Math.min(1 + stars, 6);
  if (policeCars.length < desiredCars && state.policeSpawnCooldown <= 0) {
    if (spawnPoliceCar(state)) state.policeSpawnCooldown = 1.4;
    else state.policeSpawnCooldown = 0.5;
  }
  // Stuck hunters are quietly replaced.
  for (const car of policeCars) {
    if (car.stuckTime > 2.6) {
      car.mode = 'gone';
      state.policeSpawnCooldown = 0;
    }
  }
  const desiredOfficers = stars >= 2 ? Math.min((stars - 1) * 2, 6) : 0;
  if (officers.length < desiredOfficers && state.officerSpawnCooldown <= 0) {
    const host = policeCars.find((car) => Math.hypot(car.x - state.player.x, car.y - state.player.y) < 520);
    if (host) {
      const officer = createGunman(host.x + 20, host.y + 10, 'officer');
      if (!circleBlocked(state.world, officer.x, officer.y, officer.r)) {
        state.gunmen.push(officer);
        state.officerSpawnCooldown = 2.2;
      } else {
        state.officerSpawnCooldown = 0.6;
      }
    } else {
      state.officerSpawnCooldown = 0.8;
    }
  }
  // Officers who fall too far behind give up the foot chase.
  state.gunmen = state.gunmen.filter((g) => g.role !== 'officer' || g.dead
    || Math.hypot(g.x - state.player.x, g.y - state.player.y) < 950);
}

/** Snap a car to the nearest traffic rail (used when police stand down). */
function nearestRail(state, car) {
  let best = null;
  for (let i = 0; i < AVENUES.length; i += 1) {
    for (const dir of [-1, 1]) {
      const laneX = AVENUES[i] + (dir > 0 ? -30 : 30);
      const d = Math.abs(car.x - laneX);
      if (!best || d < best.d) best = { d, rail: { rail: 'avenue', index: i, dir, pos: car.y } };
    }
  }
  for (let i = 0; i < STREETS.length; i += 1) {
    for (const dir of [-1, 1]) {
      const laneY = STREETS[i] + (dir > 0 ? 30 : -30);
      const d = Math.abs(car.y - laneY);
      if (!best || d < best.d) best = { d, rail: { rail: 'street', index: i, dir, pos: car.x } };
    }
  }
  return best.rail;
}

/* ---------------- missions ---------------- */

function stageTarget(state, stage) {
  if (!stage) return null;
  if (stage.type === 'steal') {
    return state.mission.targetCar
      ? { x: state.mission.targetCar.x, y: state.mission.targetCar.y }
      : state.world.landmarks.stealLot;
  }
  if (stage.type === 'deliverCar') return state.world.landmarks[stage.at];
  if (stage.type === 'defend') return state.world.landmarks.warehouse;
  return state.world.landmarks[stage.at];
}

function currentStages(state) {
  const m = state.mission;
  if (m.courier) return m.courier.stages;
  const mission = MISSIONS[m.index];
  return mission ? mission.stages : [];
}

function setupStage(state) {
  const m = state.mission;
  const stage = currentStages(state)[m.stageIndex];
  m.stage = stage ?? null;
  m.timer = stage && stage.timeLimit ? stage.timeLimit : null;
  if (!stage) return;
  if (stage.type === 'steal' && !m.targetCar) {
    const spot = state.world.landmarks.stealLot;
    const car = createCar(spot.x + 30, spot.y - 40, 0, 3, TARGET_CAR_COLOR, 'parked');
    car.isTargetCar = true;
    state.cars.push(car);
    m.targetCar = car;
  }
  if (stage.type === 'defend') {
    m.wave = 0;
    m.wavePause = 1.2;
  }
  if (stage.type === 'goto' && !m.courier && MISSIONS[m.index].id === 'lastledger' && !m.guardsSpawned) {
    m.guardsSpawned = true;
    const vault = state.world.landmarks.vault;
    state.gunmen.push(createGunman(vault.x - 70, vault.y - 60, 'thug'));
    state.gunmen.push(createGunman(vault.x + 80, vault.y - 30, 'thug'));
  }
}

function spawnDefendWave(state) {
  const m = state.mission;
  m.wave += 1;
  const center = state.world.landmarks.warehouse;
  const count = 2 + m.wave;
  const angles = [0.4, 1.6, 2.8, 4.0, 5.2];
  for (let i = 0; i < count; i += 1) {
    const a = angles[i % angles.length] + state.simRng.range(-0.2, 0.2);
    const radius = state.simRng.range(230, 300);
    let x = center.x + Math.cos(a) * radius;
    let y = center.y + Math.sin(a) * radius * 0.7;
    if (circleBlocked(state.world, x, y, 12)) {
      x = center.x + Math.cos(a) * 150;
      y = center.y + 120;
    }
    state.gunmen.push(createGunman(x, y, 'thug'));
  }
  toast(state, `Wave ${m.wave} — hold the yard!`, 2.2);
}

function completeMission(state) {
  const m = state.mission;
  const player = state.player;
  const finish = () => {
    const reward = m.courier ? m.courier.reward : MISSIONS[m.index].reward;
    player.cash += reward;
    state.stats.earned += reward;
    state.stats.missionsDone += 1;
    if (!m.courier) {
      state.debt = Math.max(0, state.debt - reward);
      m.index += 1;
    }
    if (state.audio) state.audio.reward();
    const wasFinale = !m.courier && m.index >= MISSIONS.length;
    m.courier = null;
    m.targetCar = null;
    m.carrying = false;
    m.phase = 'idle';
    m.stage = null;
    if (wasFinale && !state.storyDone) {
      state.storyDone = true;
      state.pendingStoryDone = true;
    } else {
      toast(state, `Job done — $${reward} earned`, 3.6);
    }
    saveSoon(state);
  };
  if (m.courier) {
    finish();
    return;
  }
  m.phase = 'outro';
  startDialogue(state, MISSIONS[m.index].outro, finish);
}

function advanceStage(state) {
  const m = state.mission;
  m.stageIndex += 1;
  if (m.stageIndex >= currentStages(state).length) {
    completeMission(state);
    return;
  }
  setupStage(state);
}

function updateMissions(state, dt) {
  const m = state.mission;
  const player = state.player;
  let events = 0;
  if (state.pendingStoryDone) {
    state.pendingStoryDone = false;
    events |= EVENT_STORY_DONE;
  }

  if (m.phase === 'idle') {
    if (state.storyDone) {
      const at = state.world.landmarks.marla;
      state.objective = { label: 'Courier work — see Marla at Café Loma', x: at.x, y: at.y };
      if (!player.inCar && dist2(player.x, player.y, at.x, at.y) < 36 * 36) {
        m.courier = courierJob(state.simRng, state.world.landmarks);
        m.stageIndex = 0;
        m.phase = 'active';
        setupStage(state);
        toast(state, 'Courier job taken — follow the marker', 3);
      }
    } else {
      const mission = MISSIONS[m.index];
      if (mission) {
        const at = state.world.landmarks[mission.startAt];
        state.objective = { label: `See Marla — “${mission.title}”`, x: at.x, y: at.y };
        if (!player.inCar && dist2(player.x, player.y, at.x, at.y) < 36 * 36) {
          m.phase = 'intro';
          startDialogue(state, mission.intro, () => {
            m.phase = 'active';
            m.stageIndex = 0;
            m.guardsSpawned = false;
            setupStage(state);
          });
        }
      } else {
        state.objective = null;
      }
    }
    return events;
  }
  if (m.phase !== 'active') {
    state.objective = null;
    return events;
  }

  const stage = m.stage;
  if (!stage) return events;
  const target = stageTarget(state, stage);
  state.objective = {
    label: stage.label,
    x: target.x,
    y: target.y,
    timer: m.timer,
  };

  if (m.timer !== null && m.timer !== undefined) {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.timer = stage.timeLimit;
      toast(state, 'Too late — the moment passed. Try again!', 3);
    }
  }

  const d2 = dist2(player.x, player.y, target.x, target.y);
  switch (stage.type) {
    case 'goto':
      if (d2 < 44 * 44) advanceStage(state);
      break;
    case 'pickup':
      if (!player.inCar && d2 < 30 * 30) {
        m.carrying = true;
        toast(state, 'Picked up', 1.6);
        advanceStage(state);
      }
      break;
    case 'deliver':
      if (m.carrying && d2 < 44 * 44) {
        m.carrying = false;
        advanceStage(state);
      }
      break;
    case 'steal':
      if (m.targetCar && state.playerCar === m.targetCar) advanceStage(state);
      break;
    case 'deliverCar':
      if (m.targetCar && state.playerCar === m.targetCar && d2 < 58 * 58) {
        m.targetCar.isTargetCar = false;
        advanceStage(state);
      }
      break;
    case 'defend': {
      const alive = state.gunmen.some((g) => g.role === 'thug' && !g.dead);
      if (!alive) {
        if (m.wave >= (stage.waves ?? 3)) {
          advanceStage(state);
        } else {
          m.wavePause -= dt;
          if (m.wavePause <= 0) {
            spawnDefendWave(state);
            m.wavePause = 2.2; // the breather before the wave after this one
            if (m.wave === 2) state.pickups.push(createPickup(target.x + 40, target.y + 30, 'ammo', 24));
            if (m.wave === 3) state.pickups.push(createPickup(target.x - 50, target.y + 20, 'health', 30));
          }
        }
      }
      break;
    }
    case 'grab':
      if (!player.inCar && d2 < 30 * 30) {
        m.carrying = true;
        state.wanted.points = Math.max(state.wanted.points, STAR_THRESHOLDS[4] + 12);
        state.wanted.stars = starsForPoints(state.wanted.points);
        toast(state, 'Ledger taken — every alarm in Portside just sang!', 3.4);
        advanceStage(state);
      }
      break;
    case 'escape':
      if (d2 < 48 * 48) advanceStage(state);
      break;
    default:
      break;
  }
  return events;
}

/* ---------------- camera, save, respawn ---------------- */

function updateCamera(state, dt) {
  const player = state.player;
  let tx = player.x;
  let ty = player.y;
  if (player.inCar && state.playerCar) {
    tx += state.playerCar.vx * 0.55;
    ty += state.playerCar.vy * 0.55;
  }
  const blend = 1 - Math.exp(-5.2 * dt);
  state.camera.x += (tx - state.camera.x) * blend;
  state.camera.y += (ty - state.camera.y) * blend;
  const hw = state.viewW / 2;
  const hh = state.viewH / 2;
  state.camera.x = Math.max(hw, Math.min(state.world.width - hw, state.camera.x));
  state.camera.y = Math.max(hh, Math.min(state.world.height - hh, state.camera.y));
}

function saveSoon(state) {
  state.saveRequested = true;
}

function makeSave(state) {
  const player = state.player;
  return {
    v: 1,
    x: player.x, y: player.y,
    health: player.health, cash: player.cash,
    mag: player.mag, reserve: player.reserve,
    missionIndex: state.mission.index,
    storyDone: state.storyDone,
    debt: state.debt,
    dayTime: state.dayTime,
    stats: { ...state.stats },
  };
}

function applySave(state, data) {
  if (!data || data.v !== 1) return false;
  const player = state.player;
  if (player.inCar) exitCar(state, false);
  player.x = data.x;
  player.y = data.y;
  player.health = Math.max(30, data.health ?? PLAYER_MAX_HEALTH);
  player.cash = data.cash ?? PLAYER_START_CASH;
  player.mag = data.mag ?? PISTOL_MAGAZINE;
  player.reserve = data.reserve ?? 36;
  state.mission.index = Math.min(data.missionIndex ?? 0, MISSIONS.length);
  state.storyDone = Boolean(data.storyDone) || state.mission.index >= MISSIONS.length;
  state.debt = data.debt ?? PLAYER_DEBT;
  state.dayTime = data.dayTime ?? DAY_START;
  Object.assign(state.stats, data.stats ?? {});
  state.camera.x = player.x;
  state.camera.y = player.y;
  return true;
}

function resetProgress(state) {
  const player = state.player;
  if (player.inCar) exitCar(state, false);
  const home = state.world.landmarks.hideout;
  player.x = home.x;
  player.y = home.y + 30;
  player.health = PLAYER_MAX_HEALTH;
  player.cash = PLAYER_START_CASH;
  player.mag = PISTOL_MAGAZINE;
  player.reserve = 36;
  player.bustedMeter = 0;
  state.wanted.points = 0;
  state.wanted.stars = 0;
  state.mission.index = 0;
  state.mission.phase = 'idle';
  state.mission.courier = null;
  state.mission.carrying = false;
  state.storyDone = false;
  state.debt = PLAYER_DEBT;
  state.stats = { earned: 0, stolen: 0, missionsDone: 0, shots: 0, takedowns: 0, arrests: 0, deaths: 0 };
  state.gunmen = [];
  state.bullets = [];
  state.camera.x = player.x;
  state.camera.y = player.y;
}

/** After a bust or a wasting: wake up somewhere official, lighter of pocket. */
function respawn(state, kind) {
  const player = state.player;
  if (player.inCar) {
    const car = state.playerCar;
    if (car && car.mode === 'player') car.mode = 'parked';
    player.inCar = false;
    state.playerCar = null;
  }
  const spot = kind === 'busted' ? state.world.landmarks.policeStation : state.world.landmarks.hospital;
  player.x = spot.x;
  player.y = spot.y + 16;
  player.vx = 0;
  player.vy = 0;
  player.health = PLAYER_MAX_HEALTH;
  player.bustedMeter = 0;
  player.hiddenTime = 0;
  const fine = kind === 'busted' ? 150 : 200;
  player.cash = Math.max(0, player.cash - fine);
  state.wanted.points = 0;
  state.wanted.stars = 0;
  if (kind === 'busted') state.stats.arrests += 1;
  else state.stats.deaths += 1;
  // The mission survives a bad day, but a defend in progress restarts its wave.
  if (state.mission.phase === 'active' && state.mission.stage && state.mission.stage.type === 'defend') {
    state.gunmen = state.gunmen.filter((g) => g.role !== 'thug');
    state.mission.wave = 0;
    state.mission.wavePause = 1.5;
  }
  state.gunmen = state.gunmen.filter((g) => g.role !== 'officer');
  state.camera.x = player.x;
  state.camera.y = player.y;
  saveSoon(state);
}
