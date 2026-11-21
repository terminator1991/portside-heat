# Portside Heat

An original open-world crime game for the make.fun gta6-01 bounty, written from
scratch as plain static files — no libraries, no build step, no network requests.
Every sprite is drawn with canvas 2D and every sound is synthesized with WebAudio.

**Story.** Portside is a sun-soaked harbour city of avenues, freight yards and one
long promenade. Rook, a small-time driver, owes fixer Marla Venn $4,000. Five jobs —
a parcel at the piers, a polite debt collection, a crimson Cabrio that needs a new
home, a night holding the Halloran freight yard, and one last ledger — pay the debt
off, if the Portside PD lets him finish them. After the story, Marla keeps offering
courier work in free roam.

**Controls**

- WASD / arrow keys — walk and drive
- Shift — sprint · Space — handbrake
- E — enter / leave a car, advance dialogue, start a job at the marker
- Mouse — aim · left click — shoot · F — melee · R — reload
- Esc / P — pause · M — mute

**Features**

- A seeded 3360×2400 city: five avenues, four streets, a park, a working harbour
  with piers, parking lots, lamps, palms and named landmarks (Café Loma, Portside
  General, Halloran Freight, the port office).
- Traffic that drives the road network with lanes, turns and obstacle checks;
  pedestrians who stroll the sidewalks and flee gunfire, crashes and crime.
- Cars to steal and drive — five models with different speed and handling, arcade
  physics, collision damage, smoke and wrecks.
- A 0–5 star wanted system: witnessed crimes raise it, police cars pursue and ram,
  officers arrest at low stars and shoot at high ones, and breaking line of sight
  lets the heat decay. Busted and wasted screens with fines and respawns.
- Combat on foot: pistol with magazines, reloads and ammo pickups, plus melee.
- Five story missions with dialogue, markers, timers, a car theft, a wave-defense
  shootout and a four-star escape finale; then repeatable courier jobs.
- HUD with health, cash and debt, wanted stars, weapon state, an objective line
  with distance and edge arrow, and a live minimap with police blips.
- A full day cycle — golden afternoon, dusk with lamp glow, night, dawn — plus
  particles, screen shake, synthesized engine, siren, gunshots and an ambient pad.
- Saving to localStorage: New Game / Continue on the title screen.

**Run it.** Serve the `game/` folder with any static file server and open
`index.html` in a desktop browser. To hand the entry in, run
`mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`, which copies the game and
screenshots to `out/` and writes the dossier.
