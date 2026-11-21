// Portside Heat — boot and screens. The simulation lives in game.js; this file owns
// the canvas, the fixed-step loop, the screen state machine (title, play, paused,
// busted, wasted, ending), the save file in localStorage, and the audio levels.
//
// ?seed=N builds a different city for the live game. ?shot=start|drive|fight|end
// (with &seed=N) stages one deterministic scene for a screenshot instead of playing.
import { STEP, SAVE_KEY, CITY_SEED } from './config.js';
import { createGame, EVENT_BUSTED, EVENT_WASTED, EVENT_STORY_DONE } from './game.js';
import {
  createInput, ACTION_INTERACT, ACTION_ATTACK, ACTION_RELOAD, ACTION_PAUSE,
  ACTION_CONFIRM, ACTION_MUTE,
} from './input.js';
import {
  createRenderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED, SCREEN_BUSTED,
  SCREEN_WASTED, SCREEN_ENDING, titleButtons,
} from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);

function fitCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

function announce(message) {
  status.textContent = message;
}

/* ---------------- screenshots ---------------- */

function runShot(name) {
  const seed = Number.isInteger(seedParam) ? seedParam : 7;
  const { game, screen } = stageShot(name, seed);
  let painted = 0;
  function paint() {
    renderer.draw(game.state, screen, { hasSave: false, muted: true });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

/* ---------------- the live game ---------------- */

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function runGame() {
  const audio = createAudio();
  const input = createInput(canvas);
  input.onFirstGesture(() => audio.unlock());
  const seed = Number.isInteger(seedParam) ? seedParam : CITY_SEED;
  const game = createGame(seed);
  const state = game.state;
  state.audio = audio;

  let saveData = readSave();
  let hasSave = Boolean(saveData);
  let started = false;
  let screen = SCREEN_TITLE;
  let muted = false;
  let accumulator = 0;
  let last = performance.now();
  let saveClock = 0;

  function writeSave() {
    if (!started) return;
    try {
      saveData = game.makeSave();
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
      hasSave = true;
    } catch {
      // Storage can be unavailable (private windows): the game simply forgets.
    }
  }

  function startNew() {
    game.newGame();
    started = true;
    screen = SCREEN_PLAY;
    writeSave();
    announce('New game. Rook owes Marla Venn four thousand dollars. Follow the gold marker.');
  }

  function startContinue() {
    if (!saveData) return;
    game.applySave(saveData);
    started = true;
    screen = SCREEN_PLAY;
    announce('Welcome back to Portside.');
  }

  function buildSimInput(actions) {
    const axes = input.axes();
    const mouse = input.mouse();
    return {
      moveX: axes.x,
      moveY: axes.y,
      sprint: input.sprint(),
      handbrake: input.handbrake(),
      interactPressed: Boolean(actions & ACTION_INTERACT),
      attackPressed: Boolean(actions & ACTION_ATTACK),
      reloadPressed: Boolean(actions & ACTION_RELOAD),
      confirmPressed: Boolean(actions & ACTION_CONFIRM),
      shootHeld: mouse.down,
      aimX: state.camera.x - canvas.width / 2 + mouse.x,
      aimY: state.camera.y - canvas.height / 2 + mouse.y,
    };
  }

  const IDLE = {
    moveX: 0, moveY: 0, sprint: false, handbrake: false, interactPressed: false,
    attackPressed: false, reloadPressed: false, confirmPressed: false,
    shootHeld: false, aimX: 0, aimY: 0,
  };

  function handleEvents(events) {
    if (events & (EVENT_BUSTED | EVENT_WASTED)) {
      screen = (events & EVENT_BUSTED) ? SCREEN_BUSTED : SCREEN_WASTED;
      audio.sting();
      announce(screen === SCREEN_BUSTED ? 'Busted.' : 'Wasted.');
    } else if (events & EVENT_STORY_DONE) {
      screen = SCREEN_ENDING;
      audio.reward();
      writeSave();
      announce('Debt paid. The story is complete.');
    }
  }

  function handleScreenActions(actions) {
    if (screen === SCREEN_TITLE) {
      if (input.takeClick()) {
        const mouse = input.mouse();
        for (const button of titleButtons(canvas.width, canvas.height, hasSave)) {
          if (mouse.x >= button.x && mouse.x <= button.x + button.w
            && mouse.y >= button.y && mouse.y <= button.y + button.h) {
            if (button.id === 'new') startNew();
            else startContinue();
            return;
          }
        }
      }
      if (actions & ACTION_CONFIRM) {
        if (hasSave) startContinue();
        else startNew();
      }
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        writeSave();
        announce('Paused.');
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    } else if (screen === SCREEN_BUSTED || screen === SCREEN_WASTED) {
      if (actions & ACTION_CONFIRM) {
        game.respawn(state.endKind === 'busted' ? 'busted' : 'wasted');
        screen = SCREEN_PLAY;
        writeSave();
        announce('Back on the street.');
      }
    } else if (screen === SCREEN_ENDING) {
      if (actions & ACTION_CONFIRM) screen = SCREEN_PLAY;
    }
  }

  function updateAudio() {
    audio.step();
    const player = state.player;
    if (screen === SCREEN_PLAY && player.inCar && state.playerCar) {
      const ratio = Math.min(1, Math.abs(state.playerCar.speed) / state.playerCar.model.topSpeed);
      audio.setEngine(true, ratio);
    } else {
      audio.setEngine(false, 0);
    }
    let nearest = Infinity;
    if (state.wanted.stars > 0) {
      for (const car of state.cars) {
        if (car.mode !== 'police') continue;
        const d = Math.hypot(car.x - player.x, car.y - player.y);
        if (d < nearest) nearest = d;
      }
    }
    audio.setSiren(nearest === Infinity ? 0 : Math.max(0, 1 - nearest / 820));
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const frameDt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    state.viewW = canvas.width;
    state.viewH = canvas.height;
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) muted = audio.toggleMute();
    handleScreenActions(actions);
    if (screen === SCREEN_PLAY || screen === SCREEN_TITLE) {
      accumulator += frameDt;
      let first = true;
      while (accumulator >= STEP && (screen === SCREEN_PLAY || screen === SCREEN_TITLE)) {
        accumulator -= STEP;
        const simInput = screen === SCREEN_PLAY ? buildSimInput(first ? actions : 0) : IDLE;
        const events = game.step(STEP, simInput);
        first = false;
        if (screen === SCREEN_PLAY && events) handleEvents(events);
      }
      if (screen === SCREEN_PLAY) {
        saveClock += frameDt;
        if (state.saveRequested || saveClock > 6) {
          state.saveRequested = false;
          saveClock = 0;
          writeSave();
        }
      }
    } else {
      accumulator = 0;
    }
    updateAudio();
    renderer.draw(state, screen, { hasSave, muted });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      writeSave();
    }
  });

  announce('Portside Heat. Start a new game, or continue.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
