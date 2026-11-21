// Portside Heat — shared constants: the shape of the city, the pace of the simulation,
// the wanted-level economy and the save-game key. Everything else reads from here.

/** Fixed simulation step, in seconds. The world only ever advances in these. */
export const STEP = 1 / 60;

/** The world the live game always builds, so a saved game wakes up in the same city. */
export const CITY_SEED = 20261121;

/** World size in pixels. The camera shows roughly 1280x720 of it at a time. */
export const WORLD_WIDTH = 3360;
export const WORLD_HEIGHT = 2400;

/** Vertical avenues and horizontal streets, by the coordinate of their centre line. */
export const AVENUES = [240, 840, 1440, 2040, 2640];
export const STREETS = [240, 840, 1440, 2040];
/** Full width of a road, kerb to kerb; lanes sit LANE_OFFSET either side of the centre,
 *  and parked cars tuck into the kerb lane outside them. */
export const ROAD_WIDTH = 144;
export const LANE_OFFSET = 30;
/** Sidewalk width along every road and around every block. */
export const SIDEWALK = 18;
/** The harbour: open water starts at this x and runs to the east edge of the world. */
export const WATER_X = 3060;

/** One full day-night cycle, in simulation seconds. */
export const DAY_LENGTH = 360;
/** Where the clock starts, as a fraction of the day (0 = midnight): golden afternoon. */
export const DAY_START = 0.68;

/** Player tuning. */
export const PLAYER_RADIUS = 13;
export const PLAYER_WALK_SPEED = 168;
export const PLAYER_SPRINT_SPEED = 268;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_START_CASH = 120;
/** The debt Rook owes Marla Venn; the story is paying it off. */
export const PLAYER_DEBT = 4000;

/** Wanted points at which each star lights up (index = stars). */
export const STAR_THRESHOLDS = [0, 50, 140, 280, 480, 750];
/** Wanted points each witnessed crime adds. */
export const CRIME_POINTS = {
  theft: 60,
  assault: 40,
  gunshot: 30,
  hitPedestrian: 85,
  hitPoliceCar: 60,
  shootOfficer: 150,
  killPedestrian: 160,
  killOfficer: 260,
  reckless: 12,
};
/** How long the player must stay unseen before wanted points start draining. */
export const HIDE_SECONDS = 5;
/** Wanted points drained per second while hidden. */
export const WANTED_DECAY = 26;

/** Combat tuning. */
export const PISTOL_DAMAGE = 34;
export const PISTOL_MAGAZINE = 12;
export const PISTOL_FIRE_INTERVAL = 0.22;
export const PISTOL_RELOAD_SECONDS = 1.1;
export const BULLET_SPEED = 1020;
export const BULLET_RANGE = 430;
export const MELEE_DAMAGE = 55;
export const MELEE_RANGE = 34;
export const ENEMY_BULLET_DAMAGE = 7;

/** localStorage key for the saved game. */
export const SAVE_KEY = 'portside-heat-save-v1';

/** Palette: sun-soaked harbour city. */
export const COLORS = {
  grass: '#8aa860',
  parkPath: '#c9b98f',
  sidewalk: '#cfc4a5',
  blockGround: '#b3a888',
  road: '#3e4046',
  roadEdge: '#d8d2ba',
  laneDash: '#e9e4cd',
  water: '#2b7d88',
  waterDeep: '#226672',
  sand: '#e6d09c',
  pier: '#9a7d55',
  warehouseYard: '#a49a80',
  lot: '#55565c',
};
