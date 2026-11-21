// Portside Heat — the city of Portside: generated from a seed into roads, blocks,
// buildings, a harbour with piers, and named landmarks the story hangs on. Also the
// collision and line-of-sight helpers every other system shares.

import {
  AVENUES, STREETS, ROAD_WIDTH, LANE_OFFSET, SIDEWALK, WATER_X,
  WORLD_WIDTH, WORLD_HEIGHT,
} from './config.js';

const BUILDING_COLORS = [
  '#e8b04b', '#e2725b', '#f2e3c6', '#9fc6c0', '#d96c4f',
  '#efe9dc', '#c8553d', '#7fb3b0', '#e9c46a', '#f4a261',
];
const ROOF_COLORS = ['#b08968', '#8d6e63', '#a26769', '#6d6875', '#97785a', '#7f5539'];

/** X of the traffic lane on avenue `avenueIndex` for travel direction `dir` (+1 = south, -1 = north). */
export function avenueLaneX(avenueIndex, dir) {
  return AVENUES[avenueIndex] + (dir > 0 ? -LANE_OFFSET : LANE_OFFSET);
}

/** Y of the traffic lane on street `streetIndex` for travel direction `dir` (+1 = east, -1 = west). */
export function streetLaneY(streetIndex, dir) {
  return STREETS[streetIndex] + (dir > 0 ? LANE_OFFSET : -LANE_OFFSET);
}

function rect(x, y, w, h, kind) {
  return { x, y, w, h, kind };
}

/**
 * Build the whole city. Landmarks sit in fixed blocks so any seed keeps the story
 * geography; the ordinary buildings between them are the seed's own.
 */
export function createWorld(rng) {
  const world = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    solids: [],
    buildings: [],
    blockGrounds: [],
    lamps: [],
    palms: [],
    crates: [],
    piers: [],
    lots: [],
    landmarks: {},
  };

  const addBuilding = (x, y, w, h, options = {}) => {
    const building = {
      x, y, w, h,
      color: options.color ?? rng.pick(BUILDING_COLORS),
      roof: options.roof ?? rng.pick(ROOF_COLORS),
      name: options.name ?? null,
      awning: options.awning ?? null,
      detailSeed: rng.int(1, 1e9),
    };
    world.buildings.push(building);
    world.solids.push(rect(x, y, w, h, 'building'));
    return building;
  };
  const addCrate = (x, y) => {
    const crate = rect(x, y, 24, 24, 'crate');
    world.crates.push(crate);
    world.solids.push(crate);
  };
  const addPalm = (x, y) => {
    world.palms.push({ x, y, r: rng.range(13, 19) });
    world.solids.push(rect(x - 4, y - 4, 8, 8, 'palm'));
  };

  // The harbour water, cut into rectangles around the three piers so the piers stay dry.
  const pierYs = [540, 1140, 1740];
  for (const cy of pierYs) world.piers.push({ x: 2960, y: cy - 44, w: 380, h: 88 });
  let waterTop = 0;
  for (const cy of pierYs) {
    world.solids.push(rect(WATER_X, waterTop, WORLD_WIDTH - WATER_X, cy - 44 - waterTop, 'water'));
    waterTop = cy + 44;
  }
  world.solids.push(rect(WATER_X, waterTop, WORLD_WIDTH - WATER_X, WORLD_HEIGHT - waterTop, 'water'));

  // Inner blocks between the avenues and streets, with their special lots reserved.
  const specialBlocks = {
    '0,0': 'hospital', '2,0': 'police', '3,0': 'pawnshop',
    '2,1': 'cafe', '1,2': 'lotA', '3,1': 'lotB',
    '0,2': 'hideout', '3,2': 'warehouse',
  };
  for (let ci = 0; ci < AVENUES.length - 1; ci += 1) {
    for (let ri = 0; ri < STREETS.length - 1; ri += 1) {
      const bx = AVENUES[ci] + ROAD_WIDTH / 2;
      const by = STREETS[ri] + ROAD_WIDTH / 2;
      const bw = AVENUES[ci + 1] - AVENUES[ci] - ROAD_WIDTH;
      const bh = STREETS[ri + 1] - STREETS[ri] - ROAD_WIDTH;
      world.blockGrounds.push({ x: bx, y: by, w: bw, h: bh, special: specialBlocks[`${ci},${ri}`] ?? null });
      buildBlock(world, rng, bx, by, bw, bh, specialBlocks[`${ci},${ri}`] ?? null, addBuilding, addCrate);
    }
  }

  // North strip: a row of city-edge buildings in the spans between avenues (the avenues
  // themselves run to the world edge). South strip: industrial sheds in the same spans.
  world.blockGrounds.push({ x: 190, y: 0, w: 2810, h: 180, special: null });
  world.blockGrounds.push({ x: 190, y: 2100, w: 2810, h: 300, special: null });
  const spans = [];
  for (let i = 0; i < AVENUES.length - 1; i += 1) {
    spans.push([AVENUES[i] + ROAD_WIDTH / 2 + 16, AVENUES[i + 1] - ROAD_WIDTH / 2 - 16]);
  }
  for (const [sx, ex] of spans) {
    addBuilding(sx, 26, Math.min(300, ex - sx), 128, {});
    addBuilding(sx + 10, 2196, Math.min(330, ex - sx - 10), 148, { color: '#9c8d77', roof: '#6d6875' });
  }

  // West strip: the park — paths, palms and two kiosks, kept open.
  world.blockGrounds.push({ x: 0, y: 0, w: 180, h: WORLD_HEIGHT, special: 'park' });
  addBuilding(36, 420, 108, 84, { color: '#f2e3c6', name: 'KIOSK' });
  addBuilding(36, 1560, 108, 84, { color: '#f2e3c6', name: 'KIOSK' });
  for (let i = 0; i < 16; i += 1) addPalm(rng.range(24, 160), rng.range(80, WORLD_HEIGHT - 80));

  // The promenade along the harbour: sand, lamps, crates and the dock office (the vault).
  world.blockGrounds.push({ x: 2700, y: 0, w: WATER_X - 2700, h: WORLD_HEIGHT, special: 'promenade' });
  addBuilding(2760, 1050, 190, 180, { color: '#8d6e63', roof: '#5d4a42', name: 'PORT OFFICE' });
  for (const cy of pierYs) {
    addCrate(2990, cy - 70);
    addCrate(3020, cy + 44);
    addCrate(3220, cy - 30);
  }
  for (let y = 120; y < WORLD_HEIGHT; y += 260) addPalm(3028, y);

  // Lamps along both kerbs of every road.
  for (const cx of AVENUES) {
    for (let y = 90; y < WORLD_HEIGHT; y += 175) {
      world.lamps.push({ x: cx - ROAD_WIDTH / 2 - 8, y }, { x: cx + ROAD_WIDTH / 2 + 8, y: y + 80 });
    }
  }
  for (const cy of STREETS) {
    for (let x = 340; x < 2980; x += 175) {
      world.lamps.push({ x, y: cy - ROAD_WIDTH / 2 - 8 }, { x: x + 80, y: cy + ROAD_WIDTH / 2 + 8 });
    }
  }

  world.landmarks = {
    hideout: { x: 600, y: 1865 },
    marla: { x: 1660, y: 1368 },
    hospital: { x: 540, y: 800 },
    policeStation: { x: 1740, y: 800 },
    warehouse: { x: 2340, y: 1885 },
    vault: { x: 2855, y: 1262 },
    docks: { x: 3275, y: 1140 },
    debtSpot: { x: 2340, y: 668 },
    stealLot: { x: 1140, y: 1730 },
    park: { x: 95, y: 1200 },
  };
  return world;
}

/** Fill one city block according to its reserved use (or ordinary buildings). */
function buildBlock(world, rng, bx, by, bw, bh, special, addBuilding, addCrate) {
  const ix = bx + SIDEWALK + 10;
  const iy = by + SIDEWALK + 10;
  const iw = bw - (SIDEWALK + 10) * 2;
  const ih = bh - (SIDEWALK + 10) * 2;
  if (special === 'hospital') {
    addBuilding(ix + 20, iy + 10, iw - 40, ih - 130, { color: '#f4f1e8', roof: '#b08968', name: 'PORTSIDE GENERAL' });
    return;
  }
  if (special === 'police') {
    addBuilding(ix + 40, iy + 10, iw - 80, ih - 150, { color: '#7d8aa0', roof: '#4c5a75', name: 'POLICE' });
    return;
  }
  if (special === 'pawnshop') {
    addBuilding(ix + 40, iy + 10, iw - 80, ih - 190, { color: '#c8553d', roof: '#7f3b2c', name: 'EZ PAWN' });
    return;
  }
  if (special === 'cafe') {
    addBuilding(ix + 10, iy + 150, 240, 230, { color: '#e9c46a', roof: '#b08968', name: 'CAFÉ LOMA', awning: '#c8553d' });
    addBuilding(ix + 290, iy + 20, 140, 160, {});
    addBuilding(ix + 290, iy + 220, 140, 160, {});
    return;
  }
  if (special === 'hideout') {
    addBuilding(ix + 10, iy + 30, 230, 190, { color: '#97785a', roof: '#5d4a42', name: 'ROOK’S GARAGE' });
    addBuilding(ix + 290, iy + 30, 140, 350, {});
    return;
  }
  if (special === 'warehouse') {
    addBuilding(ix + 10, iy + 10, iw - 20, 230, { color: '#8d8d99', roof: '#565664', name: 'HALLORAN FREIGHT' });
    addCrate(ix + 60, iy + 300);
    addCrate(ix + 96, iy + 300);
    addCrate(ix + 60, iy + 336);
    addCrate(ix + iw - 110, iy + 310);
    addCrate(ix + iw - 74, iy + 310);
    return;
  }
  if (special === 'lotA' || special === 'lotB') {
    const lot = { x: ix + 10, y: iy + 40, w: iw - 20, h: ih - 110 };
    world.lots.push(lot);
    return;
  }
  // Ordinary block: a 2x2 of plots with alleys between, one plot sometimes left a yard.
  const plotW = (iw - 26) / 2;
  const plotH = (ih - 26) / 2;
  for (let px = 0; px < 2; px += 1) {
    for (let py = 0; py < 2; py += 1) {
      if (rng.chance(0.14)) continue;
      const inset = rng.range(4, 18);
      addBuilding(
        ix + px * (plotW + 26) + inset,
        iy + py * (plotH + 26) + inset,
        plotW - inset * 2,
        plotH - inset * 2,
        {},
      );
    }
  }
}

/** Does a circle touch any solid? Used for spawn checks and quick tests. */
export function circleBlocked(world, x, y, r) {
  for (const s of world.solids) {
    const nx = Math.max(s.x, Math.min(x, s.x + s.w));
    const ny = Math.max(s.y, Math.min(y, s.y + s.h));
    const dx = x - nx;
    const dy = y - ny;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** Is a single point inside any solid (expanded by pad)? */
export function pointBlocked(world, x, y, pad = 0) {
  for (const s of world.solids) {
    if (x > s.x - pad && x < s.x + s.w + pad && y > s.y - pad && y < s.y + s.h + pad) return true;
  }
  return false;
}

/**
 * Move a circular body {x, y, r} by (dx, dy), sliding along solids.
 * Returns true when the body hit something on either axis.
 */
export function moveCircle(world, body, dx, dy) {
  let hit = false;
  body.x += dx;
  for (const s of world.solids) {
    if (!circleRectOverlap(body.x, body.y, body.r, s)) continue;
    const pushLeft = body.x + body.r - s.x;
    const pushRight = s.x + s.w - (body.x - body.r);
    body.x += pushLeft < pushRight ? -pushLeft : pushRight;
    hit = true;
  }
  body.y += dy;
  for (const s of world.solids) {
    if (!circleRectOverlap(body.x, body.y, body.r, s)) continue;
    const pushUp = body.y + body.r - s.y;
    const pushDown = s.y + s.h - (body.y - body.r);
    body.y += pushUp < pushDown ? -pushUp : pushDown;
    hit = true;
  }
  body.x = Math.max(body.r, Math.min(world.width - body.r, body.x));
  body.y = Math.max(body.r, Math.min(world.height - body.r, body.y));
  return hit;
}

function circleRectOverlap(x, y, r, s) {
  const nx = Math.max(s.x, Math.min(x, s.x + s.w));
  const ny = Math.max(s.y, Math.min(y, s.y + s.h));
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy < r * r;
}

/**
 * Clear line of sight between two points: buildings block it, low crates and palms do not.
 * Sampled every few pixels — cheap and plenty for a top-down city.
 */
export function lineOfSightClear(world, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.floor(dist / 18));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    for (const b of world.buildings) {
      if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return false;
    }
  }
  return true;
}

/** A random point on a random traffic lane, for spawning traffic and police. */
export function randomLaneSpawn(rng) {
  if (rng.chance(0.55)) {
    const index = rng.int(0, AVENUES.length - 1);
    const dir = rng.chance(0.5) ? 1 : -1;
    return { rail: 'avenue', index, dir, pos: rng.range(80, WORLD_HEIGHT - 80) };
  }
  const index = rng.int(0, STREETS.length - 1);
  const dir = rng.chance(0.5) ? 1 : -1;
  return { rail: 'street', index, dir, pos: rng.range(80, WATER_X - 120) };
}

/** World position of a rail state {rail, index, dir, pos}. */
export function railPosition(railState) {
  if (railState.rail === 'avenue') {
    return { x: avenueLaneX(railState.index, railState.dir), y: railState.pos };
  }
  return { x: railState.pos, y: streetLaneY(railState.index, railState.dir) };
}

/** Parking spots: along kerbs and inside the two lots. Returns [{x, y, angle}]. */
export function parkingSpots(world, rng) {
  const spots = [];
  for (const cx of AVENUES) {
    for (let y = 330; y < WORLD_HEIGHT - 120; y += rng.int(120, 210)) {
      if (STREETS.some((cy) => Math.abs(y - cy) < 110)) continue;
      const side = rng.chance(0.5) ? -1 : 1;
      spots.push({ x: cx + side * (ROAD_WIDTH / 2 - 13), y, angle: side < 0 ? Math.PI : 0 });
    }
  }
  for (const lot of world.lots) {
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        if (rng.chance(0.25)) continue;
        spots.push({ x: lot.x + 44 + col * 96, y: lot.y + 52 + row * 108, angle: 0 });
      }
    }
  }
  return spots;
}
