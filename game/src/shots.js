// Portside Heat — the screenshot scenes behind ?shot=start|drive|fight|end.
// Each scene builds the real game from the seed, plays the real simulation forward
// with an autopilot for a fixed number of fixed steps, and returns the screen the
// renderer should paint. Same seed, same frame, every time.

import { STEP, STAR_THRESHOLDS } from './config.js';
import { createGame } from './game.js';
import { createCar, createGunman, CAR_COLORS } from './entities.js';
import { SCREEN_TITLE, SCREEN_PLAY, SCREEN_BUSTED } from './render.js';

const IDLE_INPUT = {
  moveX: 0, moveY: 0, sprint: false, handbrake: false,
  interactPressed: false, attackPressed: false, shootHeld: false,
  aimX: 0, aimY: 0, reloadPressed: false, confirmPressed: false,
};

function runSteps(game, seconds, autopilot) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const input = autopilot ? autopilot(game.state, i) : IDLE_INPUT;
    game.step(STEP, input);
  }
}

/** A waypoint driver for the chase scene: steers the player's car around a loop. */
function makeDriver(route) {
  let leg = 0;
  return (state) => {
    const car = state.playerCar;
    if (!car) return IDLE_INPUT;
    let target = route[leg % route.length];
    const d = Math.hypot(target.x - car.x, target.y - car.y);
    if (d < 120) {
      leg += 1;
      target = route[leg % route.length];
    }
    const want = Math.atan2(target.x - car.x, -(target.y - car.y));
    let diff = want - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return {
      ...IDLE_INPUT,
      moveX: Math.max(-1, Math.min(1, diff * 2.2)),
      moveY: -1,
      aimX: car.x + Math.sin(car.angle) * 100,
      aimY: car.y - Math.cos(car.angle) * 100,
    };
  };
}

/** Stage the title: the city alive at golden hour, the player by the harbour. */
function stageStart(game) {
  const state = game.state;
  const docks = state.world.landmarks.docks;
  state.player.x = docks.x - 190;
  state.player.y = docks.y + 30;
  state.player.angle = Math.PI / 2;
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  runSteps(game, 6, null);
  // Frame the promenade, the port office and a slice of water, not open sea.
  state.camera.x = state.player.x - 150;
  state.camera.y = state.player.y + 10;
  return SCREEN_TITLE;
}

/** Stage the chase: Rook in a roadster, two stars, the law on his tail. */
function stageDrive(game) {
  const state = game.state;
  const world = state.world;
  const startX = 1440;
  const startY = 1050;
  const car = createCar(startX, startY, Math.PI, 3, '#e9c46a', 'player');
  state.cars.push(car);
  state.playerCar = car;
  state.player.inCar = true;
  state.player.x = startX;
  state.player.y = startY;
  state.wanted.points = STAR_THRESHOLDS[2] + 20;
  state.wanted.stars = 2;
  // Two patrol cars already rolling behind him.
  for (const back of [170, 320]) {
    const cop = createCar(startX + 24, startY - back, Math.PI, 4, '#eef2f5', 'police');
    state.cars.push(cop);
  }
  // The story is mid-job: a parcel to take back to Marla.
  state.mission.phase = 'active';
  state.mission.stageIndex = 2;
  state.mission.stage = { type: 'deliver', at: 'marla', label: 'Bring the parcel back to Marla' };
  state.mission.carrying = true;
  state.objective = { label: 'Bring the parcel back to Marla', x: world.landmarks.marla.x, y: world.landmarks.marla.y };
  const route = [
    { x: 1440, y: 1500 }, { x: 1440, y: 1960 }, { x: 1980, y: 2040 },
    { x: 2560, y: 2040 }, { x: 2640, y: 1500 }, { x: 2640, y: 950 },
    { x: 1980, y: 840 }, { x: 1500, y: 840 },
  ];
  runSteps(game, 9, makeDriver(route));
  // The chase escalates itself while it runs; the photograph is composed as the
  // two-star pursuit it began as, with the car battered but rolling and the law
  // visibly on its tail.
  state.wanted.points = STAR_THRESHOLDS[2] + 20;
  state.wanted.stars = 2;
  if (car.health < 72) car.health = 72;
  const law = state.cars.filter((c) => c.mode === 'police');
  const anyNear = law.some((c) => Math.hypot(c.x - car.x, c.y - car.y) < 460);
  if (law.length > 0 && !anyNear) {
    const cop = law[0];
    cop.x = car.x - Math.sin(car.angle) * 250;
    cop.y = car.y + Math.cos(car.angle) * 250;
    cop.angle = car.angle;
    cop.vx = 0;
    cop.vy = 0;
  }
  state.camera.x = car.x;
  state.camera.y = car.y;
  return SCREEN_PLAY;
}

/** Stage the shootout: the warehouse yard, three attackers, rounds in the air. */
function stageFight(game) {
  const state = game.state;
  const yard = state.world.landmarks.warehouse;
  state.player.x = yard.x - 30;
  state.player.y = yard.y + 26;
  state.player.angle = 0.6;
  state.player.cash = 2740;
  const spots = [
    { x: yard.x + 120, y: yard.y - 60 },
    { x: yard.x + 190, y: yard.y + 70 },
    { x: yard.x - 170, y: yard.y + 110 },
  ];
  for (const spot of spots) state.gunmen.push(createGunman(spot.x, spot.y, 'thug'));
  state.mission.phase = 'active';
  state.mission.stage = { type: 'defend', at: 'warehouse', label: 'Hold the yard', waves: 3 };
  state.mission.wave = 1;
  state.objective = { label: 'Hold the yard', x: yard.x, y: yard.y };
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  const fighter = (s) => {
    let nearest = null;
    let best = Infinity;
    for (const g of s.gunmen) {
      if (g.dead) continue;
      const d = (g.x - s.player.x) ** 2 + (g.y - s.player.y) ** 2;
      if (d < best) { best = d; nearest = g; }
    }
    // Fight from inside the yard: drift back to its heart when pushed out of it.
    const home = Math.hypot(yard.x - s.player.x, yard.y - s.player.y);
    if (home > 110) {
      return {
        ...IDLE_INPUT,
        moveX: Math.sign(yard.x - s.player.x) * 0.8,
        moveY: Math.sign(yard.y - s.player.y) * 0.8,
        shootHeld: s.player.mag > 0 && nearest !== null,
        aimX: nearest ? nearest.x : yard.x,
        aimY: nearest ? nearest.y : yard.y,
      };
    }
    if (!nearest) return IDLE_INPUT;
    const strafe = Math.sin(s.time * 1.7) > 0 ? 0.55 : -0.55;
    return {
      ...IDLE_INPUT,
      moveX: strafe,
      moveY: 0.1,
      shootHeld: s.player.mag > 0,
      aimX: nearest.x,
      aimY: nearest.y,
    };
  };
  runSteps(game, 5, fighter);
  // The photograph shows a fight in progress, never a corpse: top the player back
  // up, clear the police the gunfire drew, and make sure attackers are still
  // standing in the yard for the frame.
  if (state.player.health < 55) state.player.health = 55;
  state.cars = state.cars.filter((c) => c.mode !== 'police');
  state.gunmen = state.gunmen.filter((g) => g.role !== 'officer');
  state.wanted.points = 0;
  state.wanted.stars = 0;
  const standing = state.gunmen.filter((g) => !g.dead
    && Math.hypot(g.x - yard.x, g.y - yard.y) < 320);
  if (standing.length < 2) {
    state.gunmen.push(createGunman(yard.x + 130, yard.y - 30, 'thug'));
    state.gunmen.push(createGunman(yard.x - 150, yard.y + 90, 'thug'));
  }
  state.camera.x = (state.player.x + yard.x) / 2;
  state.camera.y = (state.player.y + yard.y) / 2;
  return SCREEN_PLAY;
}

/** Stage the ending of a chase: surrounded at the station, the meter full. */
function stageEnd(game) {
  const state = game.state;
  const station = state.world.landmarks.policeStation;
  state.player.x = station.x + 30;
  state.player.y = station.y + 90;
  state.player.angle = -0.5;
  state.player.cash = 1915;
  state.player.bustedMeter = 1;
  state.wanted.points = STAR_THRESHOLDS[3] + 30;
  state.wanted.stars = 3;
  state.stats.missionsDone = 3;
  state.stats.earned = 2450;
  state.stats.stolen = 4;
  const ring = [
    { x: state.player.x - 60, y: state.player.y - 30, a: 1.2 },
    { x: state.player.x + 64, y: state.player.y + 6, a: -1.4 },
    { x: state.player.x + 4, y: state.player.y + 74, a: 3.1 },
  ];
  for (const spot of ring) {
    const officer = createGunman(spot.x, spot.y, 'officer');
    officer.angle = spot.a;
    state.gunmen.push(officer);
  }
  for (const back of [-120, 130]) {
    const cop = createCar(state.player.x + back, state.player.y - 120, Math.PI * 0.8, 4, '#eef2f5', 'police');
    state.cars.push(cop);
  }
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  // A breath of ambient life behind the bust screen: traffic rolls and the patrol
  // cars close in. The officers do shoot at three stars, so afterwards the ring is
  // re-pinned around the player and the frame is composed as staged.
  for (let i = 0; i < 90; i += 1) game.step(STEP, IDLE_INPUT);
  state.gunmen = state.gunmen.filter((g) => g.role !== 'officer');
  for (const spot of ring) {
    const officer = createGunman(spot.x, spot.y, 'officer');
    officer.angle = spot.a;
    state.gunmen.push(officer);
  }
  state.player.health = 78;
  state.player.bustedMeter = 1;
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  return SCREEN_BUSTED;
}

/**
 * Build the game for a screenshot scene and stage it.
 * Returns { game, screen } for the boot module to paint.
 */
export function stageShot(name, seed) {
  const game = createGame(seed);
  game.state.viewW = 1280;
  game.state.viewH = 720;
  if (name === 'drive') return { game, screen: stageDrive(game) };
  if (name === 'fight') return { game, screen: stageFight(game) };
  if (name === 'end') return { game, screen: stageEnd(game) };
  return { game, screen: stageStart(game) };
}
