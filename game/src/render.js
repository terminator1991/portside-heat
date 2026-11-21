// Portside Heat — the renderer: the whole game is canvas 2D. The world pass paints
// the city, harbour, traffic, crowds and combat; the HUD pass paints health, cash,
// wanted stars, the objective and the minimap; screens (title, pause, busted,
// wasted, ending) are overlays the boot module switches between.

import {
  AVENUES, STREETS, ROAD_WIDTH, WATER_X, WORLD_WIDTH, WORLD_HEIGHT, COLORS,
  PLAYER_MAX_HEALTH, STAR_THRESHOLDS,
} from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';
export const SCREEN_ENDING = 'ending';

/** Button rectangles on the title screen, shared by the painter and the click tests. */
export function titleButtons(viewW, viewH, hasSave) {
  const w = 300;
  const h = 48;
  const x = viewW / 2 - w / 2;
  const buttons = [{ id: 'new', x, y: viewH * 0.60, w, h, label: 'NEW GAME' }];
  if (hasSave) buttons.push({ id: 'continue', x, y: viewH * 0.60 + 60, w, h, label: 'CONTINUE' });
  return buttons;
}

/** Daylight at a day fraction: how dark the tint is and how warm the light runs. */
function daylightAt(t) {
  const keys = [
    [0.0, 0.52, 0.0], [0.22, 0.52, 0.0], [0.28, 0.16, 0.5], [0.34, 0.0, 0.15],
    [0.68, 0.0, 0.2], [0.76, 0.2, 0.85], [0.83, 0.5, 0.25], [0.92, 0.54, 0.0], [1.0, 0.52, 0.0],
  ];
  for (let i = 0; i < keys.length - 1; i += 1) {
    const [t0, d0, w0] = keys[i];
    const [t1, d1, w1] = keys[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / Math.max(0.0001, t1 - t0);
      return { dark: d0 + (d1 - d0) * f, warm: w0 + (w1 - w0) * f };
    }
  }
  return { dark: 0.5, warm: 0 };
}

function shade(hex, factor) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

/** A tiny deterministic generator for per-building roof detail. */
function detailRandom(seed) {
  let s = (seed >>> 0) || 7;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // A pre-rendered radial glow sprite for lamps and headlights.
  const glow = document.createElement('canvas');
  glow.width = 96;
  glow.height = 96;
  const glowCtx = glow.getContext('2d');
  const gradient = glowCtx.createRadialGradient(48, 48, 2, 48, 48, 48);
  gradient.addColorStop(0, 'rgba(255,214,140,0.55)');
  gradient.addColorStop(0.4, 'rgba(255,190,100,0.18)');
  gradient.addColorStop(1, 'rgba(255,190,100,0)');
  glowCtx.fillStyle = gradient;
  glowCtx.fillRect(0, 0, 96, 96);

  function draw(state, screen, ui) {
    const W = canvas.width;
    const H = canvas.height;
    const camX = state.camera.x - W / 2 + (state.shake ? (state.fxRng.range(-1, 1) * state.shake) : 0);
    const camY = state.camera.y - H / 2 + (state.shake ? (state.fxRng.range(-1, 1) * state.shake) : 0);
    const view = { x: camX, y: camY, w: W, h: H };
    drawWorld(state, view);
    if (screen === SCREEN_TITLE) {
      drawTitle(state, W, H, ui);
    } else {
      drawHud(state, W, H, ui);
      if (screen === SCREEN_PAUSED) drawPause(state, W, H);
      else if (screen === SCREEN_BUSTED) drawEndScreen(state, W, H, 'BUSTED', '#7fb3ff', [
        'The Portside PD walks you to the station.',
        `Fine paid: $150 · Arrests so far: ${state.stats.arrests + 1}`,
        'Press Enter to step back onto the street',
      ]);
      else if (screen === SCREEN_WASTED) drawEndScreen(state, W, H, 'WASTED', '#ff7a6b', [
        'You wake up at Portside General with a headache and a bill.',
        `Hospital bill: $200 · Times wasted: ${state.stats.deaths + 1}`,
        'Press Enter to get back out there',
      ]);
      else if (screen === SCREEN_ENDING) drawEnding(state, W, H);
    }
  }

  /* ---------------- the world ---------------- */

  function drawWorld(state, view) {
    const world = state.world;
    const light = daylightAt(state.dayTime);
    ctx.fillStyle = COLORS.sidewalk;
    ctx.fillRect(0, 0, view.w, view.h);

    // Block grounds: sidewalk apron outside, a use-coloured inner ground.
    for (const g of world.blockGrounds) {
      if (!intersects(g, view)) continue;
      ctx.fillStyle = COLORS.sidewalk;
      fillRectView(g, view);
      const inner = { x: g.x + 18, y: g.y + 18, w: g.w - 36, h: g.h - 36 };
      ctx.fillStyle = g.special === 'park' ? COLORS.grass
        : g.special === 'promenade' ? COLORS.sand
          : g.special === 'warehouse' ? COLORS.warehouseYard
            : COLORS.blockGround;
      fillRectView(inner, view);
    }
    // The park's lawn paths.
    ctx.strokeStyle = COLORS.parkPath;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(90 - view.x, 0 - view.y);
    ctx.lineTo(90 - view.x, WORLD_HEIGHT - view.y);
    ctx.stroke();

    // Water and piers.
    ctx.fillStyle = COLORS.water;
    ctx.fillRect(WATER_X - view.x, -view.y, WORLD_WIDTH - WATER_X, WORLD_HEIGHT);
    ctx.fillStyle = COLORS.waterDeep;
    for (let y = 40; y < WORLD_HEIGHT; y += 130) {
      const wave = Math.sin(state.time * 0.7 + y * 0.05) * 14;
      ctx.fillRect(WATER_X + 30 + wave - view.x, y - view.y, 90, 5);
      ctx.fillRect(WATER_X + 190 - wave - view.x, y + 55 - view.y, 70, 5);
    }
    for (const pier of world.piers) {
      ctx.fillStyle = COLORS.pier;
      fillRectView(pier, view);
      ctx.fillStyle = shade(COLORS.pier, 0.8);
      for (let x = pier.x + 16; x < pier.x + pier.w; x += 44) {
        ctx.fillRect(x - view.x, pier.y + 6 - view.y, 5, pier.h - 12);
      }
    }

    drawRoads(state, view);

    // Parking lots.
    for (const lot of world.lots) {
      if (!intersects(lot, view)) continue;
      ctx.fillStyle = COLORS.lot;
      fillRectView(lot, view);
      ctx.strokeStyle = 'rgba(240,240,230,0.5)';
      ctx.lineWidth = 2;
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          const sx = lot.x + 22 + col * 96 - view.x;
          const sy = lot.y + 16 + row * 108 - view.y;
          ctx.strokeRect(sx, sy, 48, 84);
        }
      }
    }

    // Buildings: shadow, walls, roof detail, name band.
    for (const b of world.buildings) {
      if (!intersects(b, view)) continue;
      const rnd = detailRandom(b.detailSeed);
      const heightF = 0.5 + rnd() * 0.9;
      ctx.fillStyle = 'rgba(40,30,20,0.28)';
      ctx.fillRect(b.x + 12 * heightF - view.x, b.y + 16 * heightF - view.y, b.w, b.h);
      ctx.fillStyle = b.color;
      fillRectView(b, view);
      ctx.fillStyle = b.roof;
      const inset = 10 + rnd() * 8;
      ctx.fillRect(b.x + inset - view.x, b.y + inset - view.y, b.w - inset * 2, b.h - inset * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      const acCount = Math.floor(rnd() * 3);
      for (let i = 0; i < acCount; i += 1) {
        const ax = b.x + inset + 8 + rnd() * Math.max(10, b.w - inset * 2 - 40);
        const ay = b.y + inset + 8 + rnd() * Math.max(10, b.h - inset * 2 - 40);
        ctx.fillRect(ax - view.x, ay - view.y, 22, 16);
      }
      if (b.awning) {
        ctx.fillStyle = b.awning;
        ctx.fillRect(b.x - view.x, b.y + b.h - 12 - view.y, b.w, 12);
      }
      if (b.name && b.w > 130) {
        ctx.fillStyle = 'rgba(20,16,12,0.75)';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(b.name, b.x + b.w / 2 - view.x, b.y + b.h - 16 - view.y);
      }
    }

    // Crates and palms.
    for (const c of world.crates) {
      if (!intersects(c, view)) continue;
      ctx.fillStyle = '#a9805a';
      fillRectView(c, view);
      ctx.strokeStyle = 'rgba(60,40,20,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x - view.x, c.y - view.y, c.w, c.h);
    }
    for (const palm of world.palms) {
      if (palm.x < view.x - 40 || palm.x > view.x + view.w + 40 || palm.y < view.y - 40 || palm.y > view.y + view.h + 40) continue;
      drawPalm(palm.x - view.x, palm.y - view.y, palm.r);
    }

    // The objective beacon: a pillar of light at the current target.
    if (state.objective) {
      const ox = state.objective.x - view.x;
      const oy = state.objective.y - view.y;
      const pulse = 0.65 + Math.sin(state.time * 4) * 0.2;
      ctx.fillStyle = `rgba(255,205,64,${0.16 * pulse})`;
      ctx.fillRect(ox - 13, oy - 320, 26, 320);
      ctx.strokeStyle = `rgba(255,205,64,${0.9 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(ox, oy, 22 + Math.sin(state.time * 4) * 3, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const pickup of state.pickups) drawPickup(state, pickup, view);
    for (const car of state.cars) drawCar(state, car, view, light);
    for (const ped of state.peds) drawPed(ped, view);
    for (const g of state.gunmen) drawGunman(state, g, view);
    drawMarla(state, view);
    if (!state.player.inCar) drawPlayer(state, view);
    drawBullets(state, view);
    drawParticles(state, view);

    // Lamp glow at dusk and night.
    if (light.dark > 0.1) {
      ctx.globalAlpha = Math.min(1, light.dark * 1.6);
      for (const lamp of world.lamps) {
        const lx = lamp.x - view.x;
        const ly = lamp.y - view.y;
        if (lx < -60 || lx > view.w + 60 || ly < -60 || ly > view.h + 60) continue;
        ctx.drawImage(glow, lx - 34, ly - 34, 68, 68);
      }
      ctx.globalAlpha = 1;
    }
    // Day tint.
    if (light.dark > 0.01) {
      ctx.fillStyle = `rgba(14,18,52,${(light.dark * 0.72).toFixed(3)})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (light.warm > 0.01) {
      ctx.fillStyle = `rgba(255,132,42,${(light.warm * 0.12).toFixed(3)})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }

  function drawRoads(state, view) {
    ctx.fillStyle = COLORS.road;
    for (const cx of AVENUES) {
      ctx.fillRect(cx - ROAD_WIDTH / 2 - view.x, -view.y, ROAD_WIDTH, WORLD_HEIGHT);
    }
    for (const cy of STREETS) {
      ctx.fillRect(-view.x, cy - ROAD_WIDTH / 2 - view.y, WATER_X, ROAD_WIDTH);
    }
    // Kerbs.
    ctx.fillStyle = COLORS.roadEdge;
    for (const cx of AVENUES) {
      ctx.fillRect(cx - ROAD_WIDTH / 2 - view.x, -view.y, 3, WORLD_HEIGHT);
      ctx.fillRect(cx + ROAD_WIDTH / 2 - 3 - view.x, -view.y, 3, WORLD_HEIGHT);
    }
    for (const cy of STREETS) {
      ctx.fillRect(-view.x, cy - ROAD_WIDTH / 2 - view.y, WATER_X, 3);
      ctx.fillRect(-view.x, cy + ROAD_WIDTH / 2 - 3 - view.y, WATER_X, 3);
    }
    // Centre dashes.
    ctx.fillStyle = COLORS.laneDash;
    for (const cx of AVENUES) {
      for (let y = 12; y < WORLD_HEIGHT; y += 52) {
        if (STREETS.some((cy) => Math.abs(y - cy) < ROAD_WIDTH / 2 + 8)) continue;
        ctx.fillRect(cx - 2 - view.x, y - view.y, 4, 26);
      }
    }
    for (const cy of STREETS) {
      for (let x = 12; x < WATER_X; x += 52) {
        if (AVENUES.some((cx) => Math.abs(x - cx) < ROAD_WIDTH / 2 + 8)) continue;
        ctx.fillRect(x - view.x, cy - 2 - view.y, 26, 4);
      }
    }
  }

  function drawPalm(x, y, r) {
    ctx.strokeStyle = '#7a5c38';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 3, y - 4);
    ctx.stroke();
    ctx.strokeStyle = '#3e8e4f';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(x + 3, y - 4);
      ctx.quadraticCurveTo(
        x + 3 + Math.cos(a) * r * 0.7, y - 4 + Math.sin(a) * r * 0.7 - 3,
        x + 3 + Math.cos(a) * r, y - 4 + Math.sin(a) * r + 4,
      );
      ctx.stroke();
    }
  }

  function drawPickup(state, pickup, view) {
    const x = pickup.x - view.x;
    const y = pickup.y - view.y + Math.sin(pickup.phase) * 3;
    if (x < -30 || x > view.w + 30 || y < -30 || y > view.h + 30) return;
    if (pickup.kind === 'cash') {
      ctx.fillStyle = '#2f9e44';
      ctx.fillRect(x - 9, y - 5, 18, 10);
      ctx.fillStyle = '#b2f2bb';
      ctx.fillRect(x - 9, y - 1.5, 18, 3);
    } else if (pickup.kind === 'ammo') {
      ctx.fillStyle = '#3b3b42';
      ctx.fillRect(x - 8, y - 6, 16, 12);
      ctx.fillStyle = '#e9c46a';
      ctx.fillRect(x - 5, y - 3, 3, 6);
      ctx.fillRect(x + 2, y - 3, 3, 6);
    } else {
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(x - 8, y - 8, 16, 16);
      ctx.fillStyle = '#e03131';
      ctx.fillRect(x - 2, y - 6, 4, 12);
      ctx.fillRect(x - 6, y - 2, 12, 4);
    }
  }

  function drawCar(state, car, view, light) {
    const x = car.x - view.x;
    const y = car.y - view.y;
    if (x < -80 || x > view.w + 80 || y < -80 || y > view.h + 80) return;
    const { length, width } = car.model;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(car.angle);
    // Shadow.
    ctx.fillStyle = 'rgba(30,20,10,0.3)';
    roundRect(-width / 2 + 3, -length / 2 + 5, width, length, 7);
    ctx.fill();
    // Body.
    ctx.fillStyle = car.mode === 'wrecked' ? shade('#666666', 0.7) : car.color;
    roundRect(-width / 2, -length / 2, width, length, 7);
    ctx.fill();
    // Cabin and glass.
    ctx.fillStyle = 'rgba(18,24,34,0.88)';
    roundRect(-width / 2 + 3, -length * 0.16, width - 6, length * 0.3, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(140,190,220,0.5)';
    roundRect(-width / 2 + 3, -length * 0.3, width - 6, length * 0.1, 3);
    ctx.fill();
    // Hood and trunk shading.
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(-width / 2 + 2, -length / 2 + 2, width - 4, length * 0.16);
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.fillRect(-width / 2 + 2, length / 2 - length * 0.18, width - 4, length * 0.16);
    if (car.mode === 'police' || (car.mode === 'parked' && car.color === '#eef2f5' && car.modelIndex === 4)) {
      ctx.fillStyle = '#2b50aa';
      ctx.fillRect(-width / 2, -2, width, 5);
      const flash = Math.floor(state.time * 3.4) % 2 === 0;
      ctx.fillStyle = flash ? '#ff4444' : '#aa2222';
      ctx.fillRect(-width / 4 - 3, -length * 0.05, 6, 6);
      ctx.fillStyle = flash ? '#2255ff' : '#4466ff';
      ctx.fillRect(width / 4 - 3, -length * 0.05, 6, 6);
    }
    // Headlights after dark.
    if (light.dark > 0.22 && car.mode !== 'parked' && car.mode !== 'wrecked') {
      ctx.fillStyle = 'rgba(255,240,190,0.16)';
      ctx.beginPath();
      ctx.moveTo(-width / 3, -length / 2);
      ctx.lineTo(width / 3, -length / 2);
      ctx.lineTo(width / 1.6, -length / 2 - 74);
      ctx.lineTo(-width / 1.6, -length / 2 - 74);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // The mission target car wears a pulsing ring.
    if (car.isTargetCar) {
      ctx.strokeStyle = `rgba(255,60,90,${0.7 + Math.sin(state.time * 5) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y, car.radius + 12, car.radius + 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Damage smoke is particles; a health tick for the player's own car lives in the HUD.
  }

  function drawPerson(x, y, angle, bodyColor, headColor, gunAngle) {
    ctx.fillStyle = 'rgba(30,20,10,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 3, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(x, y, 8.5, 0, Math.PI * 2);
    ctx.fill();
    if (gunAngle !== null && gunAngle !== undefined) {
      ctx.strokeStyle = '#22242a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(gunAngle) * 15, y - Math.cos(gunAngle) * 15);
      ctx.stroke();
    }
    ctx.fillStyle = headColor;
    ctx.beginPath();
    ctx.arc(x + Math.sin(angle) * 2, y - Math.cos(angle) * 2, 4.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPed(ped, view) {
    const x = ped.x - view.x;
    const y = ped.y - view.y;
    if (x < -30 || x > view.w + 30 || y < -30 || y > view.h + 30) return;
    if (ped.dead) {
      ctx.fillStyle = 'rgba(90,80,70,0.8)';
      ctx.beginPath();
      ctx.ellipse(x, y, 11, 6, ped.angle, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    drawPerson(x, y, ped.angle, ped.shirt, ped.skin, null);
    if (ped.state === 'flee') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', x, y - 14);
    }
  }

  function drawGunman(state, g, view) {
    const x = g.x - view.x;
    const y = g.y - view.y;
    if (x < -30 || x > view.w + 30 || y < -30 || y > view.h + 30) return;
    if (g.dead) {
      ctx.fillStyle = 'rgba(70,60,55,0.85)';
      ctx.beginPath();
      ctx.ellipse(x, y, 11, 6, g.angle, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const body = g.role === 'officer' ? '#2b3a67' : g.role === 'leaving' ? '#5a6a8a' : '#59331f';
    drawPerson(x, y, g.angle, body, '#e0ac69', g.angle);
    if (g.role === 'officer') {
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(x - 4, y - 12, 8, 3);
    }
  }

  function drawMarla(state, view) {
    if (state.mission.phase !== 'idle' || state.storyDone) return;
    const m = state.world.landmarks.marla;
    const x = m.x - view.x;
    const y = m.y - view.y;
    if (x < -40 || x > view.w + 40 || y < -40 || y > view.h + 40) return;
    drawPerson(x, y, Math.PI, '#8a2f4b', '#c68642', null);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MARLA', x, y - 16);
  }

  function drawPlayer(state, view) {
    const player = state.player;
    const x = player.x - view.x;
    const y = player.y - view.y;
    drawPerson(x, y, player.angle, '#0f766e', '#e0ac69', player.angle);
    ctx.fillStyle = '#99f6e4';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (player.bustedMeter > 0.02) {
      ctx.fillStyle = 'rgba(10,10,16,0.7)';
      ctx.fillRect(x - 27, y - 30, 54, 7);
      ctx.fillStyle = '#7fb3ff';
      ctx.fillRect(x - 26, y - 29, 52 * player.bustedMeter, 5);
    }
    if (player.reloading > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RELOADING', x, y - 18);
    }
  }

  function drawBullets(state, view) {
    ctx.strokeStyle = 'rgba(255,236,170,0.95)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (const b of state.bullets) {
      const x = b.x - view.x;
      const y = b.y - view.y;
      ctx.moveTo(x, y);
      ctx.lineTo(x - b.vx * 0.012, y - b.vy * 0.012);
    }
    ctx.stroke();
  }

  function drawParticles(state, view) {
    for (const p of state.particles) {
      const x = p.x - view.x;
      const y = p.y - view.y;
      if (x < -30 || x > view.w + 30 || y < -30 || y > view.h + 30) continue;
      const lifeF = 1 - p.age / p.life;
      if (p.kind === 'spark') {
        ctx.fillStyle = `rgba(255,${150 + Math.floor(80 * lifeF)},60,${lifeF})`;
        ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
      } else if (p.kind === 'smoke') {
        ctx.fillStyle = `rgba(70,66,62,${0.34 * lifeF})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'flash') {
        ctx.fillStyle = `rgba(255,220,120,${lifeF})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'sparkle') {
        ctx.fillStyle = `rgba(190,255,200,${lifeF})`;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      } else {
        ctx.fillStyle = `rgba(196,178,150,${0.6 * lifeF})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ---------------- HUD ---------------- */

  function drawHud(state, W, H, ui) {
    const player = state.player;
    // Health.
    panel(14, 14, 228, 64);
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    ctx.fillRect(24, 24, 180, 13);
    const healthF = Math.max(0, player.health / PLAYER_MAX_HEALTH);
    ctx.fillStyle = healthF > 0.5 ? '#51cf66' : healthF > 0.25 ? '#fab005' : '#ff6b6b';
    ctx.fillRect(24, 24, 180 * healthF, 13);
    ctx.fillStyle = '#f8f9fa';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`$${Math.floor(player.cash)}`, 24, 62);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = state.storyDone ? '#8ce99a' : '#ffd43b';
    ctx.fillText(state.storyDone ? 'DEBT PAID' : `Debt $${Math.floor(state.debt)}`, 108, 62);
    if (player.inCar && state.playerCar) {
      ctx.fillStyle = '#ced4da';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`${state.playerCar.model.name} · hull ${Math.max(0, Math.ceil(state.playerCar.health))}%`, 24, 76 + 14 - 14);
    }

    // Wanted stars.
    const stars = state.wanted.stars;
    ctx.font = '26px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i < stars ? '#ffd43b' : 'rgba(230,230,220,0.28)';
      ctx.fillText('★', W - 18 - (4 - i) * 30, 42);
    }
    if (stars > 0) {
      const nextAt = STAR_THRESHOLDS[Math.min(5, stars + 1)] ?? STAR_THRESHOLDS[5];
      const curAt = STAR_THRESHOLDS[stars];
      const f = Math.min(1, (state.wanted.points - curAt) / Math.max(1, nextAt - curAt));
      ctx.fillStyle = 'rgba(8,10,14,0.55)';
      ctx.fillRect(W - 168, 50, 150, 5);
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(W - 168, 50, 150 * f, 5);
      if (player.hiddenTime > 1 && player.hiddenTime < 5) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText('BREAK LINE OF SIGHT…', W - 18, 72);
      }
    }

    // Weapon.
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8f9fa';
    ctx.fillText(`PISTOL  ${player.mag} / ${player.reserve}`, W - 18, H - 20);

    drawMinimap(state, W, H);
    drawObjective(state, W, H);

    if (state.toast) {
      ctx.font = 'bold 16px system-ui, sans-serif';
      const tw = ctx.measureText(state.toast.text).width + 36;
      ctx.fillStyle = 'rgba(10,12,18,0.78)';
      roundRect(W / 2 - tw / 2, 18, tw, 34, 8);
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.textAlign = 'center';
      ctx.fillText(state.toast.text, W / 2, 41);
    }
    if (state.dialogue) drawDialogue(state, W, H);
    if (ui && ui.muted) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('SOUND OFF (M)', W - 18, H - 44);
    }
  }

  function drawObjective(state, W, H) {
    const objective = state.objective;
    if (!objective) return;
    const player = state.player;
    const dist = Math.hypot(objective.x - player.x, objective.y - player.y);
    const metres = Math.round(dist / 10);
    let text = `${objective.label} — ${metres} m`;
    if (objective.timer !== null && objective.timer !== undefined) {
      text += ` · ${Math.ceil(objective.timer)}s`;
    }
    ctx.font = 'bold 15px system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 32;
    ctx.fillStyle = 'rgba(10,12,18,0.72)';
    roundRect(W / 2 - tw / 2, H - 52, tw, 32, 8);
    ctx.fill();
    ctx.fillStyle = objective.timer !== null && objective.timer !== undefined && objective.timer < 10 ? '#ff8787' : '#ffe066';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, H - 31);
    // Edge arrow when the target is off-screen.
    const sx = objective.x - state.camera.x + W / 2;
    const sy = objective.y - state.camera.y + H / 2;
    if (sx < 0 || sx > W || sy < 0 || sy > H) {
      const cx = W / 2;
      const cy = H / 2;
      const angle = Math.atan2(sy - cy, sx - cx);
      const ax = cx + Math.cos(angle) * (Math.min(W, H) / 2 - 54);
      const ay = cy + Math.sin(angle) * (Math.min(W, H) / 2 - 54);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(255,205,64,0.92)';
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -10);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawMinimap(state, W, H) {
    const mw = 204;
    const mh = 148;
    const mx = 14;
    const my = H - mh - 14;
    ctx.fillStyle = 'rgba(10,14,18,0.82)';
    roundRect(mx, my, mw, mh, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    roundRect(mx, my, mw, mh, 8);
    ctx.stroke();
    const s = Math.min(mw / WORLD_WIDTH, mh / WORLD_HEIGHT);
    const ox = mx + (mw - WORLD_WIDTH * s) / 2;
    const oy = my + (mh - WORLD_HEIGHT * s) / 2;
    const px = (x) => ox + x * s;
    const py = (y) => oy + y * s;
    ctx.fillStyle = '#2b7d88';
    ctx.fillRect(px(WATER_X), py(0), (WORLD_WIDTH - WATER_X) * s, WORLD_HEIGHT * s);
    ctx.strokeStyle = 'rgba(220,220,205,0.5)';
    ctx.beginPath();
    for (const cx of AVENUES) {
      ctx.moveTo(px(cx), py(0));
      ctx.lineTo(px(cx), py(WORLD_HEIGHT));
    }
    for (const cy of STREETS) {
      ctx.moveTo(px(0), py(cy));
      ctx.lineTo(px(WATER_X), py(cy));
    }
    ctx.stroke();
    // Police blips.
    ctx.fillStyle = '#ff5252';
    for (const car of state.cars) {
      if (car.mode !== 'police') continue;
      ctx.fillRect(px(car.x) - 2, py(car.y) - 2, 4, 4);
    }
    for (const g of state.gunmen) {
      if (g.dead || g.role !== 'officer') continue;
      ctx.fillRect(px(g.x) - 2, py(g.y) - 2, 4, 4);
    }
    // Objective.
    if (state.objective) {
      ctx.fillStyle = '#ffd43b';
      ctx.beginPath();
      ctx.arc(px(state.objective.x), py(state.objective.y), 3.6 + Math.sin(state.time * 5) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.mission.targetCar) {
      ctx.fillStyle = '#ff60a0';
      ctx.fillRect(px(state.mission.targetCar.x) - 2.5, py(state.mission.targetCar.y) - 2.5, 5, 5);
    }
    // Player arrow.
    const player = state.player;
    ctx.save();
    ctx.translate(px(player.x), py(player.y));
    ctx.rotate(player.angle);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.4, 5);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-4.4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('PORTSIDE', mx + 8, my + 13);
  }

  function drawDialogue(state, W, H) {
    const dialogue = state.dialogue;
    const line = dialogue.lines[dialogue.index];
    if (!line) return;
    const bw = Math.min(880, W - 70);
    const bh = 108;
    const bx = W / 2 - bw / 2;
    const by = H - bh - 66;
    ctx.fillStyle = 'rgba(8,10,16,0.88)';
    roundRect(bx, by, bw, bh, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,205,64,0.5)';
    roundRect(bx, by, bw, bh, 10);
    ctx.stroke();
    ctx.fillStyle = '#ffd43b';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(line.who.toUpperCase(), bx + 22, by + 28);
    ctx.fillStyle = '#f1f3f5';
    ctx.font = '16px system-ui, sans-serif';
    wrapText(line.text, bx + 22, by + 56, bw - 44, 21);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('E / click ▸', bx + bw - 16, by + bh - 10);
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = word;
        yy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  }

  /* ---------------- screens ---------------- */

  function drawTitle(state, W, H, ui) {
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, 'rgba(24,10,4,0.62)');
    gradient.addColorStop(0.55, 'rgba(24,10,4,0.18)');
    gradient.addColorStop(1, 'rgba(10,8,14,0.66)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    const titleGradient = ctx.createLinearGradient(0, H * 0.14, 0, H * 0.34);
    titleGradient.addColorStop(0, '#ffe066');
    titleGradient.addColorStop(0.6, '#ffa94d');
    titleGradient.addColorStop(1, '#ff6b6b');
    ctx.fillStyle = titleGradient;
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.fillText('PORTSIDE HEAT', W / 2, H * 0.30);
    ctx.fillStyle = '#f8f9fa';
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillText('An open-world crime story in the harbour city of Portside', W / 2, H * 0.30 + 38);
    ctx.font = '14.5px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(248,249,250,0.88)';
    ctx.fillText('Rook owes fixer Marla Venn $4,000. Five jobs stand between him and a clean slate —', W / 2, H * 0.30 + 72);
    ctx.fillText('if the Portside PD, the Halloran crew and his own right foot let him finish them.', W / 2, H * 0.30 + 94);

    for (const button of titleButtons(W, H, ui.hasSave)) {
      ctx.fillStyle = button.id === 'new' ? 'rgba(255,150,50,0.92)' : 'rgba(20,26,38,0.85)';
      roundRect(button.x, button.y, button.w, button.h, 9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      roundRect(button.x, button.y, button.w, button.h, 9);
      ctx.stroke();
      ctx.fillStyle = button.id === 'new' ? '#231303' : '#f1f3f5';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText(button.label, W / 2, button.y + 31);
    }
    ctx.font = '12.5px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(248,249,250,0.75)';
    const controlsY = H * 0.60 + (ui.hasSave ? 128 : 68);
    ctx.fillText('WASD / arrows — move & drive · E — enter car / talk · F — melee · Mouse — aim, click — shoot', W / 2, controlsY);
    ctx.fillText('R — reload · Shift — sprint · Space — handbrake · Esc — pause · M — sound', W / 2, controlsY + 20);
  }

  function drawPause(state, W, H) {
    ctx.fillStyle = 'rgba(6,8,12,0.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8f9fa';
    ctx.font = '900 52px system-ui, sans-serif';
    ctx.fillText('PAUSED', W / 2, H * 0.4);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(248,249,250,0.85)';
    ctx.fillText(`Jobs done: ${state.stats.missionsDone} · Earned: $${state.stats.earned} · Cars stolen: ${state.stats.stolen} · Takedowns: ${state.stats.takedowns}`, W / 2, H * 0.4 + 42);
    ctx.fillText('Esc / P — resume · Your progress saves itself as you play', W / 2, H * 0.4 + 68);
  }

  function drawEndScreen(state, W, H, word, color, lines) {
    ctx.fillStyle = word === 'BUSTED' ? 'rgba(10,16,40,0.55)' : 'rgba(30,6,6,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = '900 76px system-ui, sans-serif';
    ctx.fillText(word, W / 2, H * 0.42);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#f1f3f5';
    lines.forEach((line, i) => {
      ctx.fillText(line, W / 2, H * 0.42 + 44 + i * 26);
    });
  }

  function drawEnding(state, W, H) {
    ctx.fillStyle = 'rgba(24,14,4,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe066';
    ctx.font = '900 64px system-ui, sans-serif';
    ctx.fillText('DEBT PAID', W / 2, H * 0.38);
    ctx.font = '16.5px system-ui, sans-serif';
    ctx.fillStyle = '#f1f3f5';
    ctx.fillText('The ledger is ash, the slate is clean, and Portside is yours to roam.', W / 2, H * 0.38 + 46);
    ctx.fillText(`Jobs done: ${state.stats.missionsDone} · Earned: $${state.stats.earned} · Cars stolen: ${state.stats.stolen} · Takedowns: ${state.stats.takedowns}`, W / 2, H * 0.38 + 78);
    ctx.fillStyle = 'rgba(248,249,250,0.8)';
    ctx.fillText('Press Enter — keep driving. Marla still has courier work at Café Loma.', W / 2, H * 0.38 + 112);
  }

  /* ---------------- helpers ---------------- */

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(10,12,18,0.66)';
    roundRect(x, y, w, h, 8);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function intersects(rect, view) {
    return rect.x + rect.w > view.x && rect.x < view.x + view.w
      && rect.y + rect.h > view.y && rect.y < view.y + view.h;
  }

  function fillRectView(rect, view) {
    ctx.fillRect(rect.x - view.x, rect.y - view.y, rect.w, rect.h);
  }

  return { draw };
}
