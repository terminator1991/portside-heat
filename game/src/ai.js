// Portside Heat — the city's brains: traffic cars following the road network,
// pedestrians on the sidewalks, police cars hunting the player, and gunmen on foot.
// The arcade car physics lives here too, shared by the player and the police.

import {
  AVENUES, STREETS, ROAD_WIDTH, WATER_X, WORLD_HEIGHT,
} from './config.js';
import {
  avenueLaneX, streetLaneY, railPosition, moveCircle, lineOfSightClear,
} from './world.js';
import { spawnParticle } from './entities.js';

/** Heading of a rail state: 0 faces north, growing clockwise. */
export function railAngle(rail) {
  if (rail.rail === 'avenue') return rail.dir > 0 ? Math.PI : 0;
  return rail.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

/** The crossings ahead on a rail: coordinates along its axis where roads cross it. */
function crossingsOf(rail) {
  return rail.rail === 'avenue' ? STREETS : AVENUES;
}

/** Is another vehicle within `dist` ahead of `car` (in its facing cone)? */
export function vehicleAhead(state, car, dist) {
  const fx = Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  for (const other of state.cars) {
    if (other === car || other.mode === 'wrecked') continue;
    const relX = other.x - car.x;
    const relY = other.y - car.y;
    const forward = relX * fx + relY * fy;
    if (forward < 4 || forward > dist) continue;
    const lateral = Math.abs(relX * -fy + relY * fx);
    if (lateral < 24) return other;
  }
  return null;
}

/** Is a person (pedestrian, gunman, or the player on foot) just ahead of `car`? */
function personAhead(state, car, dist) {
  const fx = Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  const check = (x, y) => {
    const relX = x - car.x;
    const relY = y - car.y;
    const forward = relX * fx + relY * fy;
    if (forward < 2 || forward > dist) return false;
    return Math.abs(relX * -fy + relY * fx) < 17;
  };
  for (const ped of state.peds) if (!ped.dead && check(ped.x, ped.y)) return true;
  for (const g of state.gunmen) if (!g.dead && check(g.x, g.y)) return true;
  if (!state.player.inCar && check(state.player.x, state.player.y)) return true;
  return false;
}

/**
 * Arcade driving physics shared by the player and police cars.
 * throttle is -1..1, steer is -1..1 (left..right), handbrake loosens the rear.
 * Returns the impact speed when the car struck something solid, else 0.
 */
export function driveCarPhysics(state, car, throttle, steer, handbrake, dt) {
  const model = car.model;
  const fx = Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  const rx = Math.cos(car.angle);
  const ry = Math.sin(car.angle);
  let vf = car.vx * fx + car.vy * fy;
  let vl = car.vx * rx + car.vy * ry;

  if (throttle > 0) vf += model.accel * throttle * dt * (vf < -10 ? 2.4 : 1);
  else if (throttle < 0) vf += model.accel * 0.85 * throttle * dt * (vf > 10 ? 2.4 : 1);
  else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 55 * dt);
  vf -= vf * 0.32 * dt;
  const maxReverse = -model.topSpeed * 0.36;
  if (vf > model.topSpeed) vf = Math.max(model.topSpeed, vf - 300 * dt);
  if (vf < maxReverse) vf = Math.min(maxReverse, vf + 240 * dt);

  const steerAuthority = Math.min(1, Math.abs(vf) / 110);
  car.angle += steer * model.grip * steerAuthority * dt * (vf < 0 ? -1 : 1) * (handbrake ? 1.45 : 1);
  vl *= Math.exp(-(handbrake ? 2.0 : 8.5) * dt);

  const nfx = Math.sin(car.angle);
  const nfy = -Math.cos(car.angle);
  const nrx = Math.cos(car.angle);
  const nry = Math.sin(car.angle);
  car.vx = nfx * vf + nrx * vl;
  car.vy = nfy * vf + nry * vl;

  const beforeX = car.vx;
  const beforeY = car.vy;
  const hit = moveCircle(state.world, car, car.vx * dt, car.vy * dt);
  car.speed = vf;
  if (!hit) return 0;
  const impact = Math.hypot(beforeX, beforeY);
  if (impact > 60) {
    car.vx = -beforeX * 0.22;
    car.vy = -beforeY * 0.22;
    car.speed = -vf * 0.22;
    return impact;
  }
  car.vx *= 0.4;
  car.vy *= 0.4;
  return 0;
}

/** Start (or continue) a turn at an intersection onto the crossing road. */
function beginTurn(state, car, crossingIndex) {
  const rail = car.rail;
  const rng = state.simRng;
  const newDir = rng.chance(0.5) ? 1 : -1;
  const from = railPosition(rail);
  let to;
  let next;
  if (rail.rail === 'avenue') {
    const cx = AVENUES[rail.index];
    to = { x: cx + newDir * 84, y: streetLaneY(crossingIndex, newDir) };
    next = { rail: 'street', index: crossingIndex, dir: newDir, pos: to.x };
  } else {
    const cy = STREETS[rail.index];
    to = { x: avenueLaneX(crossingIndex, newDir), y: cy + newDir * 84 };
    next = { rail: 'avenue', index: crossingIndex, dir: newDir, pos: to.y };
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  car.turning = {
    t: 0,
    dur: Math.max(0.4, dist / Math.max(70, car.cruiseSpeed * 0.8)),
    from,
    ctrl: { x: to.x, y: from.y },
    to,
    next,
  };
}

/** Advance a traffic car one step along the road network. */
export function updateTrafficCar(state, car, dt) {
  if (car.turning) {
    const turn = car.turning;
    turn.t += dt / turn.dur;
    const t = Math.min(1, turn.t);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    const prevX = car.x;
    const prevY = car.y;
    car.x = a * turn.from.x + b * turn.ctrl.x + c * turn.to.x;
    car.y = a * turn.from.y + b * turn.ctrl.y + c * turn.to.y;
    const dx = car.x - prevX;
    const dy = car.y - prevY;
    if (dx * dx + dy * dy > 0.001) car.angle = Math.atan2(dx, -dy);
    if (turn.t >= 1) {
      car.rail = turn.next;
      car.turning = null;
    }
    return;
  }
  const rail = car.rail;
  let target = car.cruiseSpeed;
  if (vehicleAhead(state, car, 84) || personAhead(state, car, 62)) target = 0;
  else if (vehicleAhead(state, car, 150)) target = car.cruiseSpeed * 0.4;
  const rate = target < car.speed ? 330 : 150;
  car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), rate * dt);
  const prevPos = rail.pos;
  rail.pos += rail.dir * car.speed * dt;

  // Intersection decisions, once per crossing.
  const crossings = crossingsOf(rail);
  for (let ci = 0; ci < crossings.length; ci += 1) {
    const cross = crossings[ci];
    const passed = rail.dir > 0 ? prevPos < cross && rail.pos >= cross : prevPos > cross && rail.pos <= cross;
    if (!passed) continue;
    const nearEnd = rail.rail === 'avenue'
      ? (rail.dir > 0 && ci === crossings.length - 1) || (rail.dir < 0 && ci === 0)
      : (rail.dir > 0 && cross > WATER_X - 500) || (rail.dir < 0 && ci === 0);
    if (nearEnd || state.simRng.chance(0.38)) {
      beginTurn(state, car, ci);
      break;
    }
  }
  const p = railPosition(rail);
  car.x = p.x;
  car.y = p.y;
  const want = railAngle(rail);
  car.angle += shortestAngle(want - car.angle) * Math.min(1, dt * 7);
  car.vx = Math.sin(car.angle) * car.speed;
  car.vy = -Math.cos(car.angle) * car.speed;
}

/** Wrap an angle difference to [-PI, PI]. */
export function shortestAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Put a pedestrian back on the sidewalk graph after a flee. */
function reRailPed(state, ped) {
  let best = null;
  for (let i = 0; i < AVENUES.length; i += 1) {
    for (const side of [-1, 1]) {
      const x = AVENUES[i] + side * (ROAD_WIDTH / 2 + 9);
      const d = Math.abs(ped.x - x);
      if (!best || d < best.d) best = { d, rail: { rail: 'avenue', index: i, side, dir: state.simRng.chance(0.5) ? 1 : -1, pos: ped.y } };
    }
  }
  for (let i = 0; i < STREETS.length; i += 1) {
    for (const side of [-1, 1]) {
      const y = STREETS[i] + side * (ROAD_WIDTH / 2 + 9);
      const d = Math.abs(ped.y - y);
      if (!best || d < best.d) best = { d, rail: { rail: 'street', index: i, side, dir: state.simRng.chance(0.5) ? 1 : -1, pos: ped.x } };
    }
  }
  ped.rail = best.rail;
}

/** Pedestrian position from its sidewalk rail state. */
function pedRailPosition(rail) {
  if (rail.rail === 'avenue') {
    return { x: AVENUES[rail.index] + rail.side * (ROAD_WIDTH / 2 + 9), y: rail.pos };
  }
  return { x: rail.pos, y: STREETS[rail.index] + rail.side * (ROAD_WIDTH / 2 + 9) };
}

/** Advance a pedestrian: strolling the sidewalks, or running from danger. */
export function updatePed(state, ped, dt) {
  if (ped.dead) return;
  if (ped.state === 'flee') {
    ped.fleeTime -= dt;
    const dx = ped.x - ped.fleeFromX;
    const dy = ped.y - ped.fleeFromY;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = 205;
    moveCircle(state.world, ped, (dx / dist) * speed * dt, (dy / dist) * speed * dt);
    ped.angle = Math.atan2(dx / dist, -(dy / dist));
    if (ped.fleeTime <= 0) {
      ped.state = 'walk';
      reRailPed(state, ped);
    }
    return;
  }
  const rail = ped.rail;
  if (!rail) {
    reRailPed(state, ped);
    return;
  }
  rail.pos += rail.dir * ped.walkSpeed * dt;
  const crossings = crossingsOf(rail);
  for (let ci = 0; ci < crossings.length; ci += 1) {
    const cross = crossings[ci];
    if (Math.abs(rail.pos - cross) < 4 && state.simRng.chance(0.012)) {
      // Swap onto the crossing road's sidewalk, or cross to the other side.
      if (rail.rail === 'avenue') {
        ped.rail = { rail: 'street', index: ci, side: rail.dir > 0 ? 1 : -1, dir: rail.side, pos: AVENUES[rail.index] + rail.side * (ROAD_WIDTH / 2 + 9) };
      } else {
        ped.rail = { rail: 'avenue', index: ci, side: rail.dir > 0 ? -1 : 1, dir: rail.side, pos: STREETS[rail.index] + rail.side * (ROAD_WIDTH / 2 + 9) };
      }
      break;
    }
  }
  if (rail.pos < 30 || rail.pos > (rail.rail === 'avenue' ? WORLD_HEIGHT - 30 : WATER_X - 60)) {
    rail.dir *= -1;
    rail.side *= -1;
  }
  const p = pedRailPosition(ped.rail);
  ped.x = p.x;
  ped.y = p.y;
  ped.angle = ped.rail.rail === 'avenue'
    ? (ped.rail.dir > 0 ? Math.PI : 0)
    : (ped.rail.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/** Make a pedestrian run from a point; some drop cash when the scare was a crime. */
export function scarePed(state, ped, fromX, fromY, dropCash) {
  if (ped.dead || ped.state === 'flee') return;
  ped.state = 'flee';
  ped.fleeTime = state.simRng.range(1.4, 2.8);
  ped.fleeFromX = fromX;
  ped.fleeFromY = fromY;
  if (dropCash && !ped.droppedCash && state.simRng.chance(0.3)) {
    ped.droppedCash = true;
    state.pickups.push({
      id: -1, x: ped.x, y: ped.y, kind: 'cash', amount: state.simRng.int(5, 30), phase: state.simRng.range(0, 6.28), dead: false,
    });
  }
}

/** Scare every pedestrian near a point (gunshots, crashes, reckless driving). */
export function scarePedsNear(state, x, y, radius, dropCash) {
  for (const ped of state.peds) {
    const dx = ped.x - x;
    const dy = ped.y - y;
    if (dx * dx + dy * dy < radius * radius) scarePed(state, ped, x, y, dropCash);
  }
}

/**
 * Advance a police car: full pursuit physics with building avoidance, aimed at the
 * player. A car stuck against a wall for a while gives up and is respawned by game.js.
 */
export function updatePoliceCar(state, car, dt) {
  const player = state.player;
  const tx = player.x;
  const ty = player.y;
  const dx = tx - car.x;
  const dy = ty - car.y;
  const dist = Math.hypot(dx, dy) || 1;
  const wantAngle = Math.atan2(dx, -dy);

  // Avoidance: probe ahead; if a building fills the probe, bend the desired heading.
  let steerTarget = wantAngle;
  const probeDist = 92;
  const probeX = car.x + Math.sin(car.angle) * probeDist;
  const probeY = car.y - Math.cos(car.angle) * probeDist;
  if (pointInBuilding(state.world, probeX, probeY)) {
    const leftA = wantAngle - 0.85;
    const rightA = wantAngle + 0.85;
    const leftClear = !pointInBuilding(state.world, car.x + Math.sin(leftA) * probeDist, car.y - Math.cos(leftA) * probeDist);
    const rightClear = !pointInBuilding(state.world, car.x + Math.sin(rightA) * probeDist, car.y - Math.cos(rightA) * probeDist);
    steerTarget = leftClear && !rightClear ? leftA : rightClear && !leftClear ? rightA : (Math.abs(shortestAngle(leftA - car.angle)) < Math.abs(shortestAngle(rightA - car.angle)) ? leftA : rightA);
  }
  const angleDiff = shortestAngle(steerTarget - car.angle);
  const steer = Math.max(-1, Math.min(1, angleDiff * 2.4));
  const stars = state.wanted.stars;
  let throttle = 1;
  if (dist < 60 && Math.abs(angleDiff) > 2.2) throttle = -0.7;
  else if (Math.abs(angleDiff) > 1.9) throttle = 0.25;
  const impact = driveCarPhysics(state, car, throttle, steer, false, dt);
  if (impact > 130) {
    spawnParticle(state, car.x + Math.sin(car.angle) * 22, car.y - Math.cos(car.angle) * 22, 'spark', car.angle + Math.PI, 1);
    car.health -= (impact - 110) * 0.12;
  }
  if (Math.abs(car.speed) < 22 && dist > 130) car.stuckTime += dt;
  else car.stuckTime = Math.max(0, car.stuckTime - dt * 2);
  if (stars === 0) car.stuckTime += dt * 3;
}

function pointInBuilding(world, x, y) {
  for (const b of world.buildings) {
    if (x > b.x - 6 && x < b.x + b.w + 6 && y > b.y - 6 && y < b.y + b.h + 6) return true;
  }
  return false;
}

/**
 * Advance a gunman on foot (officer or thug): close to range, strafe, fire in bursts.
 * Officers only shoot at 3+ stars; below that they close in to make an arrest.
 */
export function updateGunman(state, g, dt) {
  if (g.dead) return;
  const player = state.player;
  if (g.role === 'leaving') {
    // An officer whose heat has died down walks away from the player and fades out
    // of the chase entirely (game.js removes them once they are far enough).
    const awayX = g.x - player.x;
    const awayY = g.y - player.y;
    const awayDist = Math.hypot(awayX, awayY) || 1;
    moveCircle(state.world, g, (awayX / awayDist) * 120 * dt, (awayY / awayDist) * 120 * dt);
    g.angle = Math.atan2(awayX / awayDist, -(awayY / awayDist));
    return;
  }
  const px = player.x;
  const py = player.y;
  const dx = px - g.x;
  const dy = py - g.y;
  const dist = Math.hypot(dx, dy) || 1;
  const los = dist < 360 && lineOfSightClear(state.world, g.x, g.y, px, py);
  g.angle = Math.atan2(dx, -dy);

  const mayShoot = g.role === 'thug' || state.wanted.stars >= 3;
  const preferred = g.role === 'officer' && !mayShoot ? 26 : 165;
  let moveX = 0;
  let moveY = 0;
  const speed = g.role === 'officer' ? 158 : 146;
  if (dist > preferred + 26 || !los) {
    moveX = (dx / dist) * speed;
    moveY = (dy / dist) * speed;
  } else if (dist < preferred - 46) {
    moveX = -(dx / dist) * speed * 0.55;
    moveY = -(dy / dist) * speed * 0.55;
  } else {
    g.strafeTime -= dt;
    if (g.strafeTime <= 0) {
      g.strafeTime = state.simRng.range(0.7, 1.6);
      g.strafeDir *= -1;
    }
    moveX = (-dy / dist) * g.strafeDir * 52;
    moveY = (dx / dist) * g.strafeDir * 52;
  }
  moveCircle(state.world, g, moveX * dt, moveY * dt);

  // Firing: bursts of three with a thinking pause, only with a clear shot.
  g.shootCooldown -= dt;
  if (g.burstPause > 0) g.burstPause -= dt;
  if (mayShoot && los && dist < 330 && g.burstPause <= 0) {
    if (g.burstLeft <= 0 && g.shootCooldown <= 0) {
      g.burstLeft = 3;
      g.shootCooldown = 0.13;
    }
    if (g.burstLeft > 0 && g.shootCooldown <= 0) {
      g.burstLeft -= 1;
      g.shootCooldown = 0.13;
      if (g.burstLeft === 0) g.burstPause = state.simRng.range(0.75, 1.35);
      fireBullet(state, g, px, py);
    }
  }
}

/** Fire one enemy bullet from a gunman toward a point, with spread. */
function fireBullet(state, g, tx, ty) {
  const base = Math.atan2(tx - g.x, -(ty - g.y));
  const spread = state.simRng.range(-0.075, 0.075);
  const angle = base + spread;
  state.bullets.push({
    x: g.x + Math.sin(angle) * 14,
    y: g.y - Math.cos(angle) * 14,
    vx: Math.sin(angle) * 880,
    vy: -Math.cos(angle) * 880,
    angle,
    fromPlayer: false,
    travelled: 0,
    dead: false,
  });
  spawnParticle(state, g.x + Math.sin(angle) * 16, g.y - Math.cos(angle) * 16, 'flash');
  if (Math.hypot(tx - g.x, ty - g.y) < 760 && state.audio) state.audio.shot();
}
