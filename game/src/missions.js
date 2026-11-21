// Portside Heat — the story: five jobs for fixer Marla Venn that pay off Rook's debt,
// then open-ended courier work. Stages name landmarks (see world.js); the simulation
// in game.js resolves them to places and runs them.
//
// Stage types:
//   goto      — reach the place, on foot or by car
//   pickup    — reach the place on foot and take the thing
//   deliver   — reach the place while carrying the thing
//   steal     — get into the one marked car (spawned when the job starts)
//   deliverCar— be inside the marked car at the place
//   defend    — hold the place against `waves` waves of attackers
//   grab      — reach the place on foot; taking the loot raises the heat hard
//   escape    — reach the place with the law on you

export const MISSIONS = [
  {
    id: 'paperwork',
    title: 'Paperwork at the Piers',
    startAt: 'marla',
    reward: 450,
    intro: [
      { who: 'Marla Venn', text: 'Rook. You owe me four grand, and your face is not collateral. So you work.' },
      { who: 'Rook', text: 'Driving, I hope. I am only good at driving and disappointing people.' },
      { who: 'Marla Venn', text: 'A courier dropped a parcel at the middle pier and got shy. Fetch it, bring it back here. Quietly.' },
    ],
    outro: [
      { who: 'Marla Venn', text: 'Dry, sealed, on time. Maybe there is hope for you.' },
      { who: 'Rook', text: 'Put it on my tab. Against the debt, I mean.' },
      { who: 'Marla Venn', text: 'Already done. Four hundred and fifty closer to free, driver.' },
    ],
    stages: [
      { type: 'goto', at: 'docks', label: 'Go to the middle pier' },
      { type: 'pickup', at: 'docks', label: 'Pick up the parcel on foot' },
      { type: 'deliver', at: 'marla', label: 'Bring the parcel back to Marla' },
    ],
  },
  {
    id: 'collection',
    title: 'A Polite Collection',
    startAt: 'marla',
    reward: 700,
    intro: [
      { who: 'Marla Venn', text: 'Ezra at the pawnshop owes me for a watch that was never his. He is expecting a courier.' },
      { who: 'Rook', text: 'And if he pays in excuses?' },
      { who: 'Marla Venn', text: 'He will not. He likes his windows. Get there before he closes — the clock is running.' },
    ],
    outro: [
      { who: 'Ezra (by phone)', text: 'Tell Marla the envelope is full and my windows are beautiful and intact.' },
      { who: 'Marla Venn', text: 'Polite works. Seven hundred off your debt, Rook.' },
    ],
    stages: [
      { type: 'goto', at: 'debtSpot', label: 'Reach EZ Pawn before it closes', timeLimit: 75 },
      { type: 'pickup', at: 'debtSpot', label: 'Collect the envelope on foot' },
      { type: 'deliver', at: 'marla', label: 'Bring the envelope to Marla' },
    ],
  },
  {
    id: 'crimson',
    title: 'The Crimson Cabrio',
    startAt: 'marla',
    reward: 900,
    intro: [
      { who: 'Marla Venn', text: 'A crimson Cabrio sits in the south lot, bought with money that was partly mine.' },
      { who: 'Rook', text: 'You want it moved. Quietly?' },
      { who: 'Marla Venn', text: 'I want it in my cousin’s yard by the freight hall. The owner may object. Drive like you mean it.' },
    ],
    outro: [
      { who: 'Marla Venn', text: 'Not a scratch worth mentioning. Nine hundred, gone from your debt.' },
      { who: 'Rook', text: 'It drove like a song. A loud, illegal song.' },
    ],
    stages: [
      { type: 'goto', at: 'stealLot', label: 'Go to the south parking lot' },
      { type: 'steal', label: 'Steal the crimson Cabrio' },
      { type: 'deliverCar', at: 'warehouse', label: 'Deliver the Cabrio to the freight yard' },
    ],
  },
  {
    id: 'nightwatch',
    title: 'Night Watch at Halloran',
    startAt: 'marla',
    reward: 1100,
    intro: [
      { who: 'Marla Venn', text: 'Halloran Freight keeps losing cargo to a crew with more guns than manners. Tonight you are the manners.' },
      { who: 'Rook', text: 'I am a driver, Marla. Drivers drive.' },
      { who: 'Marla Venn', text: 'Tonight you stand in a yard and look expensive to replace. Hold it until they give up.' },
    ],
    outro: [
      { who: 'Marla Venn', text: 'The yard stands, the cargo stands, and so do you. Eleven hundred.' },
      { who: 'Rook', text: 'Next time the manners get a bigger stick.' },
    ],
    stages: [
      { type: 'goto', at: 'warehouse', label: 'Go to the Halloran freight yard' },
      { type: 'defend', at: 'warehouse', label: 'Hold the yard', waves: 3 },
    ],
  },
  {
    id: 'lastledger',
    title: 'The Last Ledger',
    startAt: 'hideout',
    reward: 1600,
    intro: [
      { who: 'Marla Venn (by phone)', text: 'Last job, Rook. The port office keeps a ledger that ends my business or yours.' },
      { who: 'Rook', text: 'And the guards?' },
      { who: 'Marla Venn', text: 'Take the ledger and every alarm in Portside will sing. Get home, and the debt dies tonight.' },
    ],
    outro: [
      { who: 'Marla Venn', text: 'The ledger is ash, the debt is ash, and you are a free driver, Rook.' },
      { who: 'Rook', text: 'Free. I might just keep driving anyway. The city grows on you.' },
    ],
    stages: [
      { type: 'goto', at: 'vault', label: 'Go to the port office' },
      { type: 'grab', at: 'vault', label: 'Take the ledger on foot' },
      { type: 'escape', at: 'hideout', label: 'Lose yourself home — reach the garage' },
    ],
  },
];

/** The marker text shown when no job is running. */
export function nextJobHint(missionIndex, storyDone) {
  if (storyDone) return 'Free roam — Marla still has courier work at Café Loma';
  const mission = MISSIONS[missionIndex];
  if (!mission) return 'Free roam';
  return `See Marla — next job: ${mission.title}`;
}

/** A repeatable courier job for after the story, built from two landmarks. */
export function courierJob(rng, landmarks) {
  const keys = Object.keys(landmarks).filter((k) => k !== 'park');
  const from = keys[rng.int(0, keys.length - 1)];
  let to = keys[rng.int(0, keys.length - 1)];
  if (to === from) to = keys[(keys.indexOf(from) + 3) % keys.length];
  return {
    from, to,
    reward: 140 + rng.int(0, 10) * 15,
    stages: [
      { type: 'pickup', at: from, label: 'Pick up the courier parcel on foot' },
      { type: 'deliver', at: to, label: 'Deliver the parcel' },
    ],
  };
}
