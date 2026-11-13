# BOLTYARD — build spec (v1)

Single source of truth for every agent on this build. Read all of it before writing code.
If something here is ambiguous, pick the simplest reading, note it in your final report, and keep going.

## 1. What we are making

**Boltyard** is a short, *active* incremental game for phone browsers (works on desktop too), shipped as one
self-contained HTML page. Robots theme. Think Nodebuster's loop: short runs you are meant to fail, a
gated upgrade tree between runs, a boss per area, a real ending after roughly an hour.

- **Premise.** Yard 9, a robot recycling plant, has woken up. You pilot **Sprocket**, a small salvage bot with an
  arc coil. Each **shift** Sprocket's battery drains. Zap rogue bots into scrap, vacuum up the **bolts**, get towed
  back to the **Workshop**, bolt on upgrades, clock in again. Scrap enough bots in one shift and the sector's
  **Warden** (boss) comes for you. Beat all five Wardens; the last one, **the Overseer**, only shows up once
  Sprocket has been rebuilt as a **Titan**.
- **The player must never be waiting on a bar.** No idle income, no timers to sit through. Every second of a shift
  is steering; every workshop visit is a choice.
- **Runs are meant to be failed.** First shift lasts ~15 s. Each Warden should take 2–4 attempts.
- **Tone.** Dry workplace humour, short. Shifts, clocking in, shift reports, safety signage. No lore dumps.
- **Words used in the UI.** Shift (a run), Workshop (hub), Blueprint (upgrade tree), Bolts (main currency),
  Cores (boss currency), Battery (run timer / health), Arc (your attack), Warden (boss), Signal (boss meter),
  Overclock (kill-streak power mode), Sector (area).

## 2. Files, ownership, module pattern

```
boltyard/
  SPEC.md
  src/data.js       content + numbers              (Engine agent; Balance agent tunes numbers)
  src/engine.js     rules, no DOM                  (Engine agent)
  src/sprites.js    procedural robot art + icons   (Sprites agent)
  src/audio.js      synthesized sound              (Audio agent)
  src/render.js     arena canvas renderer + FX     (Render agent)
  src/shell.html    page markup                    (UI agent)
  src/style.css     all CSS                        (UI agent)
  src/ui.js         screens, input, loop, save     (UI agent)
  tools/build.js    assembles dist/index.html      (UI agent)
  tools/autopilot.js  bot player (move + shop)     (Engine agent)
  tools/test-engine.js, tools/simbot.js            (Engine agent)
  tools/*           each agent's own harnesses
  dist/index.html   built page
  shots/            screenshots
```

**Only edit files you own.** If you find a bug in someone else's file, report it (file, line, what, suggested fix)
instead of editing — unless your brief says otherwise.

**Module pattern** — plain scripts, no bundler, no imports, ES2019, works in Node and in a `<script>`:

```js
(function (root) {
  'use strict';
  var BY = root.BY = root.BY || {};
  // ...
  BY.Engine = { /* ... */ };
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Node tools load them with `require('../src/data.js'); require('../src/engine.js'); const BY = globalThis.BY;`.
Script order in the page: data, engine, sprites, audio, render, ui. No file may touch `window`/`document` at load
time except ui.js (others only inside functions called by ui.js). engine.js and data.js never touch the DOM.

**Tooling available:** Node 22, Playwright at `/opt/npm-tools/node_modules/playwright`, Chrome at
`/usr/bin/google-chrome`. No network, no installs. Headless launch that works here:

```js
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
```

Google Fonts will not load in this sandbox (no network), so screenshots show fallback fonts. That is expected.
Look at your own screenshots with the Read tool — you can see images.

## 3. The shift (run) — rules

Logical arena: width **360**, height **H** between 480 and 760 (set by the screen; bots use 360×640). Origin top-left.
Fixed timestep `TICK = 1/60`. All randomness from a seeded PRNG (mulberry32) stored on the run, so a
`(save, sector, seed, inputs)` replay is deterministic.

### 3.1 Sprocket
- Follows an **input target point**. Each tick the engine clamps the target to the arena and to a **leash** of 130
  units from Sprocket, then steers: desired velocity = direction × `speed` × min(1, dist/24); actual velocity
  moves 25% of the way to desired each tick. Sprocket stays inside the arena (margin = its radius).
  If input is `null`, the target stays where it was.
- **Battery** starts full. Drain per second = `1 × (1 + sag × t)` where `t` is shift time ("heat sag"), so every
  shift ends eventually. Hostile hits subtract battery. At 0 the shift ends (`reason: 'battery'`).
- **Arc.** A pulse cooldown runs all the time. When it is ready and at least one bot's edge is inside the
  field radius, the arc fires: hits up to `targets` bots, nearest first, for `damage` each (crit chance →
  ×`critMult`). Invulnerable bots are skipped. Then cooldown = `pulseInterval` (halved during Overclock).
- **Armor** (`armor: 0.5`): plain arc and drone hits do 50% damage; crits, chain and overload ignore armor.
- **Kill.** Drops pickups, adds the bot's `signal` to the Warden signal, combo +1 (combo resets after 2.5 s
  without a kill), battery += `recycle`, Overclock charge += 1/12 if unlocked.
  - *Chain* (if owned): an arc jumps from the dead bot to the nearest living bot within 100 for
    `chainPct × damage`. A chain kill can chain again (max depth 6).
  - *Overload* (if owned): the dead bot explodes for `overloadPct × its maxHp` to bots within 55. Explosion kills
    explode too (max depth 6 per original kill).
- **Overclock** (if owned): charge 0→1 from kills; decays 1/12 per 1.5 s once 2 s pass without a kill. At 1 it
  triggers on its own: for `ocDur` seconds pulse interval is halved, battery does not drain, speed +25%.
  Then charge resets to 0.
- **Drones** orbit Sprocket at radius 34, evenly spaced, rotating 2.2 rad/s. Each has its own cooldown
  (`droneInterval`) and zaps the nearest bot within 70 of the drone for `droneDmg` (armor applies, no crit).
  With Collector Arms, a drone collects any pickup within 26 of it.
- **Spare Cell** (if owned): the first time battery hits 0 in a shift, it is set to `sparePct × maxBattery` instead.

### 3.2 Pickups
- Kinds: `bolt` (value), `core` (1), `cell` (restores 15% of max battery).
- A bot's bolts (`enemy.bolts × sector.bolts × boltMult`, ×4 if elite, rounded, min 1) are split across 1–5 pickups.
- They burst outward with friction, become collectible after 0.25 s, are pulled toward Sprocket inside `magnet`
  radius, and are collected within `player.r + 6`. Uncollected pickups blink after 12 s and vanish at 15 s.
- Collected value goes into `run.earned`. Nothing is banked to the save until `endShift`.
- At shift end, *Yard Sweep* collects 50% / 100% (by value) of bolts still on the floor; cores on the floor are
  always collected.

### 3.3 Spawning
- Shift opens with 4 bots already inside the arena (not within 90 of Sprocket, never hostile types).
- `maxAlive(t) = min(sector.cap, 5 + 0.25·t)`. Spawn timer interval = `max(0.3, 0.8 − 0.008·t)`; a bot spawns
  only if alive < maxAlive. While a Warden is active, maxAlive ×0.4.
- Type is picked by weight from `sector.mix`; an entry may have `after: seconds`.
- Bots enter from a random edge, 20 units outside, heading for a random interior point.
- From sector 2, 4% of spawns are **elite**: hp ×4, bolts ×4, radius ×1.25, signal ×2.
- Each spawn has a `0.5% + lucky` chance to be a **Gilded Bot** instead (max one alive).
- Bot hp = `base hp × sector.hp`. Hostile damage = `base × sector.dmg × (1 − plating)`.

### 3.4 Behaviours
`drift` (wanders to a new interior waypoint every 3–6 s), `roll` (straight line, bounces off walls),
`chase` (homes on Sprocket), `flee` (runs from Sprocket, stays in the arena; Gilded leaves after 9 s),
`plant` (walks to a spot, stops, then shoots at Sprocket on a timer), `bomber` (chases; contact = explode, hurt
Sprocket, die with no drops; if killed first it explodes for 3× its maxHp to bots within 60), `static` (pylon).
Bots softly separate from each other so they do not stack perfectly. Contact damage is per second while
overlapping Sprocket. Shots are circles (r 5) that hurt on contact and vanish, or leave the arena.

### 3.5 Warden (boss)
- `signal` fills from kills. At `need` (reduced by Lure Beacon): state `warning` for 2.5 s, then the Warden
  spawns at the top centre and state is `active`. Sprocket gets an **emergency reserve**: battery += 25% of max
  (capped at max).
- Wardens use data-driven attacks, each telegraphed through `run.hazards` before it lands:
  - `slam`: circle on Sprocket's current position, windup, then hurts if Sprocket is inside.
  - `charge`: line from the boss through Sprocket, windup, then the boss dashes along it; contact hurts.
  - `ring`: N shots fired radially.
  - `summon`: spawns K bots of a type next to the boss.
  - `shield`: at listed hp fractions the boss turns invulnerable and spawns 3 `pylon` bots; it is vulnerable
    again when they are all dead.
  - Phases (Overseer): attack sets switch at hp fractions; `cadence` multiplies all attack timers.
- Warden dead → all pickups on the floor are collected, its bolts and cores are added, the shift ends 1.5 s
  later with `reason: 'victory'`. First clear of sector N unlocks sector N+1. Clearing sector 5 wins the game.
- Sector 5 signal does not fill until Titan Frame is built.

### 3.6 Ending a shift
`endShift(run, save)` (idempotent) banks `run.earned`, updates stats/codex/unlocks, returns the report.
Player can clock out early from pause (`reason: 'clockout'`) and keeps what was collected.

## 4. Content tables (starting numbers — the Balance agent tunes these later)

### 4.1 Sprocket base stats
`r 12 · battery 15 · drain 1/s · sag 0.02 · damage 1 · pulse 0.5 s · radius 46 · targets 1 · speed 260 ·
magnet 60 · critMult 3 · leash 130`

### 4.2 Upgrades (the Blueprint)
Cost in bolts at level L (0-based, the level you are buying) = `round(base × growth^L)`. `cores` lists the core
cost for each level (0 = none). A node is **unlocked** when every `requires` entry is met; all nodes are always
**visible** (locked ones show what they need). `col,row` place the node on a 5-column grid, root at the top.

| id | name | branch | col,row | max | base, growth | cores per level | requires | effect per level |
|---|---|---|---|---|---|---|---|---|
| coil | Coil Voltage | arc | 0,1 | 25 | 4, 1.33 | – | – | +1 arc damage |
| pulse | Pulse Rate | arc | 0,2 | 12 | 10, 1.5 | – | coil 1 | pulse interval ×0.94 |
| field | Field Radius | arc | 1,2 | 10 | 8, 1.5 | – | coil 1 | +5 field radius |
| fork | Fork | arc | 0,3 | 4 | 45, 3.2 | – | pulse 1 | +1 bot hit per pulse |
| amp | Amplifier | arc | 1,3 | 8 | 120, 2.6 | 1,1,1,2,2,2,3,3 | field 1 | arc damage ×1.25 |
| surge | Surge | arc | 0,4 | 8 | 70, 1.75 | – | fork 1 | +5% chance of a ×3 hit |
| chain | Chain Lightning | arc | 1,4 | 5 | 160, 2.3 | 1,0,0,1,1 | fork 1 | scrapped bots arc to a neighbour for 50% (+25%/lvl) of arc damage |
| overload | Overload | arc | 1,5 | 5 | 320, 2.4 | 1,0,1,0,1 | chain 1 | scrapped bots explode for 12% of their max HP per level |
| cell | Power Cell | chassis | 2,1 | 20 | 5, 1.35 | – | – | +3 max battery |
| thrust | Thrusters | chassis | 2,2 | 8 | 8, 1.6 | – | cell 1 | +22 speed |
| recycler | Recycler | chassis | 2,3 | 5 | 30, 2.2 | – | thrust 1 | +0.1 battery per bot scrapped |
| capacitor | Overclock | chassis | 2,4 | 5 | 90, 2.4 | 1,0,0,1,1 | recycler 1 | unlocks Overclock (4 s); +1 s per further level |
| coolant | Coolant Loop | chassis | 2,5 | 5 | 60, 2.0 | – | capacitor 1 | heat sag −12% |
| plating | Plating | chassis | 2,6 | 6 | 80, 1.9 | – | coolant 1 | −9% damage from hostile bots |
| spare | Spare Cell | chassis | 2,7 | 3 | 500, 4 | 1,2,2 | plating 1 | once per shift a flat battery restarts at 30/45/60% |
| magnet | Magnet | salvage | 3,1 | 8 | 5, 1.55 | – | – | +14 pickup radius |
| sorter | Bolt Sorter | salvage | 3,2 | 15 | 12, 1.5 | – | magnet 1 | +15% bolt value |
| sweep | Yard Sweep | salvage | 3,3 | 2 | 60, 6 | – | sorter 1 | shift end collects 50% / 100% of bolts left on the floor |
| lucky | Gold Sniffer | salvage | 3,4 | 5 | 100, 2.2 | – | sweep 1 | Gilded Bots +1.5% per spawn |
| beacon | Lure Beacon | salvage | 3,5 | 4 | 150, 2.5 | – | lucky 1 | Warden signal needed −8% |
| extract | Core Extractor | salvage | 3,6 | 3 | 400, 4 | 1,1,2 | beacon 1 | Wardens drop +1 core; elites 6% to drop a core |
| drone | Drone Bay | drones | 4,1 | 4 | 50, 4 | 1,1,2,2 | – | +1 drone (zaps for 50% of arc damage every 0.9 s) |
| dronedmg | Drone Coils | drones | 4,2 | 5 | 80, 2.3 | – | drone 1 | drone zaps +20% of arc damage |
| dronerate | Servo Sync | drones | 4,3 | 6 | 100, 2.0 | – | dronedmg 1 | drone zap interval ×0.9 |
| collector | Collector Arms | drones | 4,4 | 1 | 600, 1 | 1 | dronerate 1 | drones pick up bolts they pass over |
| titan | Titan Frame | core | 2,8 | 1 | 40000, 1 | 8 | spare 1, overload 1, extract 1, collector 1 | damage ×3, battery ×1.5, field radius +25%; Sprocket becomes a Titan; lures the Overseer |

A pre-owned root node `boot` ("Sprocket", col 2,row 0, max 1, level 1 in every save) is drawn at the top; the four
nodes with no `requires` hang off it.

Each upgrade in data.js also has `desc` (one short sentence, player-facing) and `fmt(level)` returning the
player-facing value at that level (e.g. `"+9 battery"`, `"×0.83 interval"`).

### 4.3 Derived stats — `BY.Engine.stats(save)`
```
damage        = (1 + coil) × 1.25^amp × (titan ? 3 : 1)
pulseInterval = 0.5 × 0.94^pulse
radius        = (46 + 5·field) × (titan ? 1.25 : 1)
targets       = 1 + fork
critChance    = 0.05 × surge            critMult = 3
chainPct      = chain ? 0.25 + 0.25·chain : 0
overloadPct   = 0.12 × overload
maxBattery    = (15 + 3·cell) × (titan ? 1.5 : 1)
speed         = 260 + 22·thrust
recycle       = 0.1 × recycler
ocUnlocked    = capacitor ≥ 1           ocDur = 3 + capacitor
sag           = 0.02 × (1 − 0.12·coolant)
plating       = 0.09 × plating
sparePct      = [0, .30, .45, .60][spare]
magnet        = 60 + 14·magnet
boltMult      = 1 + 0.15·sorter
sweepPct      = [0, .5, 1][sweep]
gildedChance  = 0.005 + 0.015·lucky
signalMult    = 1 − 0.08·beacon
bossCoreBonus = extract                 eliteCoreChance = 0.06·extract
drones        = drone
droneDmg      = damage × (0.5 + 0.2·dronedmg)
droneInterval = 0.9 × 0.9^dronerate
collector     = collector ≥ 1
titan         = titan ≥ 1
```
`BY.Engine.loadout(save)` → `{ arc, chassis, salvage, drones, titan }` for the art: branch tiers 0–3 from total
levels bought in that branch (arc: 0 / ≥1 / ≥12 / ≥30; chassis: 0 / ≥1 / ≥10 / ≥25; salvage: 0 / ≥1 / ≥8 / ≥20),
`drones` = drone count 0–4, `titan` boolean.

### 4.4 Rogue bots (sector-1 values)
| id | name | hp | r | speed | bolts | signal | behaviour | hostile |
|---|---|---|---|---|---|---|---|---|
| scrapling | Scrapling | 3 | 11 | 24 | 1 | 1 | drift | – |
| roller | Roller | 5 | 12 | 70 | 2 | 1 | roll | – |
| sparker | Sparker | 8 | 12 | 46 | 3 | 2 | chase | contact 2.5/s |
| shieldbot | Bulwark | 16 | 15 | 18 | 6 | 2 | drift, armor 0.5 | – |
| hauler | Hauler | 45 | 22 | 12 | 16 | 4 | drift; 25% to drop a cell | – |
| splitter | Splitter | 10 | 15 | 28 | 3 | 2 | drift; splits into 3 mites | – |
| mite | Mite | 2 | 7 | 80 | 1 | 0 | flee | – |
| turret | Sentry | 18 | 14 | 30 | 7 | 3 | plant; shoots every 2.6 s (speed 110, 3 dmg) | shots |
| bomber | Fuse | 6 | 12 | 85 | 3 | 2 | bomber (5 dmg on contact) | contact |
| gilded | Gilded Bot | 12 | 12 | 95 | 20 | 0 | flee; leaves after 9 s | – |
| pylon | Shield Pylon | 30 | 13 | 0 | 0 | 0 | static | – |

Each has a one-line `blurb` for the codex and a `serial` (e.g. `SCR-3`).

### 4.5 Sectors
| # | name | hp× | bolts× | dmg× | signal need | cap | mix (weights; `@s` = only after s seconds) | Warden | cores first / repeat |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Conveyor Yard | 1 | 1 | 1 | 22 | 16 | scrapling 70, roller 30, sparker 12@15 | compactor | 2 / 1 |
| 2 | Crusher Row | 4.5 | 4 | 1.3 | 34 | 18 | scrapling 35, roller 25, sparker 15, shieldbot 15, hauler 6, splitter 8 | shredder | 3 / 1 |
| 3 | The Smelter | 20 | 15 | 1.7 | 46 | 20 | scrapling 20, roller 15, sparker 14, shieldbot 14, hauler 8, splitter 12, bomber 12, turret 8 | furnace | 4 / 2 |
| 4 | Assembly Line | 85 | 55 | 2.2 | 58 | 22 | scrapling 10, roller 15, sparker 15, shieldbot 16, hauler 10, splitter 12, bomber 14, turret 12 | foreman | 5 / 2 |
| 5 | Core Vault | 360 | 200 | 3 | 70 | 24 | roller 14, sparker 16, shieldbot 18, hauler 12, splitter 12, bomber 16, turret 14 | overseer | win |

### 4.6 Wardens (absolute numbers; damage still × sector dmg and plating)
| id | name | hp | r | move | bolts | attacks |
|---|---|---|---|---|---|---|
| compactor | The Compactor | 140 | 32 | chase 26, contact 4/s | 60 | slam every 4 s (r 60, windup 1.1 s, 4 dmg) |
| shredder | The Shredder | 1100 | 30 | chase 20, contact 4/s | 400 | charge every 3.8 s (windup 0.9 s, dash 420, 6 dmg); summon 3 rollers every 9 s |
| furnace | Furnace Mother | 7000 | 38 | static, top centre | 2200 | ring every 3.2 s (10 shots, speed 95, 4 dmg); summon 2 bombers every 7 s; slam every 6 s (r 64, 1.0 s, 5 dmg) |
| foreman | Foreman Unit | 36000 | 32 | chase 30, contact 5/s | 9000 | shield at 75% and 40% hp; charge every 4.5 s (0.9 s, dash 440, 7 dmg); ring every 5 s (8 shots, speed 100, 4 dmg) |
| overseer | The Overseer | 220000 | 42 | chase 18, contact 6/s | 0 | phase 1 (100–66%): slam every 3 s (r 66, 1.0 s, 6 dmg), summon 2 sparkers every 8 s · phase 2 (66–33%): charge every 4 s (0.8 s, dash 460, 8 dmg), ring every 4 s (12 shots, speed 105, 5 dmg) · phase 3 (<33%): all of the above at cadence ×0.75, shield once at 33% |

## 5. Engine contract (`BY.Data`, `BY.Engine`)

### 5.1 Save
```js
save = {
  v: 1,
  bolts: 0, cores: 0,
  up: { boot: 1, coil: 0, /* every upgrade id */ },
  sectorsCleared: 0,                 // highest sector whose Warden has been scrapped
  bossKills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  sector: 1,                         // last selected
  seen: {},                          // enemy/boss ids met → true (codex)
  stats: { shifts: 0, kills: 0, boltsTotal: 0, coresTotal: 0, playTime: 0, bestCombo: 0, bestShiftBolts: 0,
           wonShifts: null, wonPlayTime: null },
  flags: { won: false, movedOnce: false },
  settings: { sound: true, shake: true }
}
```

### 5.2 Functions
```js
BY.Engine.newSave()                    -> save
BY.Engine.loadSave(any)                -> save   // validates / repairs anything (null, junk, old) — never throws
BY.Engine.stats(save)                  -> Stats  // §4.3
BY.Engine.loadout(save)                -> { arc, chassis, salvage, drones, titan }
BY.Engine.upgradeInfo(save, id)        -> { id, name, branch, col, row, desc, level, max, maxed,
                                            unlocked, lockReason,          // e.g. "Needs Fork"
                                            cost: { bolts, cores } | null, // null when maxed
                                            affordable,                    // unlocked && !maxed && can pay
                                            now, next }                    // fmt(level), fmt(level+1) | null
BY.Engine.buy(save, id)                -> boolean // true if bought (mutates save)
BY.Engine.affordableCount(save)        -> number  // how many nodes can be bought right now
BY.Engine.sectorInfo(save, n)          -> { id, name, unlocked, cleared, lockReason, bossId, bossName,
                                            need,          // signal needed after Lure Beacon
                                            lureBlocked }  // sector 5 without Titan
BY.Engine.startShift(save, sector, { w, h, seed, attract }) -> run
BY.Engine.step(run, save, input)       // input = { x, y } target in arena units, or null. Advances one TICK.
BY.Engine.clockOut(run)                // ends the shift now with reason 'clockout'
BY.Engine.endShift(run, save)          -> report  // idempotent
```
`attract: true` gives a demo shift for the title screen: no battery drain, no Warden, nothing earned or recorded.

### 5.3 Run state (read by the renderer and HUD every frame — keep these names exactly)
```js
run = {
  sector, w, h, seed, t, tick, attract,
  over: false, reason: null,            // 'battery' | 'victory' | 'clockout'
  stats,                                // Stats snapshot taken at startShift
  player: { x, y, r, vx, vy, tx, ty,    // tx,ty = clamped target
            battery, maxBattery,
            pulse,                      // 0..1 progress to next pulse ready
            hurt,                       // seconds since last damage (large when none)
            oc: { unlocked, charge, active, time, dur },
            spareUsed, titan },
  enemies: [ { id, type, x, y, vx, vy, r, hp, maxHp, armor, elite, boss, hostile, invuln,
               flash,                   // seconds of hit-flash left
               age, facing,             // facing in radians
               planted,                 // sentries: true once stopped
               windup } ],              // 0..1 while a boss winds up an attack, else 0
  pickups: [ { id, kind, value, x, y, vx, vy, age } ],
  shots:   [ { id, x, y, vx, vy, r, age } ],
  hazards: [ { id, kind,                // 'slam' | 'charge'
               x, y, r,                 // slam circle
               x2, y2, w,               // charge line end + width
               t, dur } ],              // lands when t >= dur
  drones:  [ { x, y, angle, cd } ],
  boss: { state,                        // 'none' | 'warning' | 'active' | 'dead'
          signal, need, blocked,        // blocked = sector 5 without Titan
          id, name, enemyId, hp, maxHp, phase, warn },   // warn = seconds left of warning
  combo: { n, t },
  earned: { bolts, cores },
  counts: { kills, bestCombo, elites, gilded },
  events: []                            // appended by step(); the consumer clears it with run.events.length = 0
}
```

### 5.4 Events (exact `type` strings and fields)
```
pulse     { x, y, r }                               arc fired
zap       { x1, y1, x2, y2, crit, src }             src: 'arc' | 'drone' | 'chain'
hit       { x, y, dmg, crit, armored, enemyId }
kill      { x, y, r, enemyType, elite, boss, bolts }
explode   { x, y, r, src }                          src: 'overload' | 'bomber'
spawn     { enemyId, enemyType, x, y, elite }
pickup    { kind, value, x, y }
hurt      { amount, x, y, src }                     src: 'contact' | 'shot' | 'slam' | 'charge' | 'bomb'
shot      { x, y }                                  an enemy fired
lowBattery{ }                                       battery crossed below 25%
spare     { }                                       Spare Cell kicked in
ocStart   { dur }      ocEnd { }
combo     { n }                                     every 5th kill in a streak
bossWarn  { name, dur }
bossSpawn { enemyId, name }
bossPhase { phase }
telegraph { kind, x, y, r, dur }                    an attack began winding up
slam      { x, y, r }                               a slam landed
shield    { on }                                    boss shield up / down
bossDead  { x, y, name, bolts, cores }
sectorClear { sector, first }
end       { reason }
```

### 5.5 Report
```js
report = { reason, sector, time, bolts, cores, kills, bestCombo, swept,   // swept = bolts added by Yard Sweep
           signalPct,                // 0..1 how close to the Warden (1 if it showed up)
           bossSeen, bossDefeated, firstClear, unlockedSector,   // number | null
           gameWon,                  // true only on the shift that first beats the Overseer
           newSeen }                 // [ids] first met this shift
```

## 6. Presentation contracts

### 6.1 `BY.Sprites` (sprites.js) — all art is drawn in code, no image files, no emoji
```js
BY.Sprites.PALETTE                                   // the colours in §7, as an object
BY.Sprites.player(ctx, x, y, r, o)                   // o: { t, facing, loadout, oc, hurt (0..1), pulse (0..1), titan }
BY.Sprites.enemy(ctx, e, t)                          // e: an enemy from run.enemies (handles every type + all 5 Wardens)
BY.Sprites.pickup(ctx, p, t)                         // bolt = hex nut, core = glowing violet cell, cell = small battery
BY.Sprites.drone(ctx, x, y, t)
BY.Sprites.shot(ctx, s, t)
BY.Sprites.icon(name, size)                          -> inline SVG markup string, uses currentColor
BY.Sprites.portrait(canvas, kind, id, opts)          // kind 'player' (opts.loadout) | 'enemy' (id = type); fits the canvas, handles DPR
```
Icon names: every upgrade id plus `boot, bolt, core, battery, signal, lock, pause, play, sound, soundOff, gear,
close, check, blueprint, codex, log, warn, arrow`.
Sprites are drawn centred on (x, y) at radius r in arena units (the caller has already set the transform).
Every bot type must be recognisable by **silhouette alone** at r = 11 on a phone; hostile types carry the rust
colour; elites get a ring; `flash > 0` draws the bot white-hot; armor shows as a visible shield plate; `invuln`
shows a hard shield bubble. Sprocket visibly changes with `loadout` (bigger coil, bigger battery pack, magnet
antenna, and a much larger, heavier Titan form).

### 6.2 `BY.Audio` (audio.js) — WebAudio synthesis only, no files
```js
BY.Audio.unlock()            // call inside the first user gesture; creates/resumes the AudioContext
BY.Audio.setEnabled(bool)
BY.Audio.play(name, opts)    // opts: { pitch, vol }
BY.Audio.handle(events, run) // maps engine events to sounds, with rate limiting
```
Names: `click, buy, deny, clockin, zap, crit, kill, killBig, pickup, core, cell, hurt, low, ocStart, ocEnd, combo,
bossWarn, bossSpawn, bossDead, slam, explode, shot, shiftEnd, victory, unlock`.
Must never throw (no AudioContext, suspended context, called before unlock → silently do nothing).

### 6.3 `BY.Render` (render.js) — the arena canvas
```js
BY.Render.init(canvas, { reducedMotion, shake })
BY.Render.setOptions({ reducedMotion, shake })
BY.Render.resize()                 // call on init and whenever the canvas's CSS size changes
BY.Render.arenaSize()              -> { w: 360, h }   // h = clamp(360 × cssH / cssW, 480, 760)
BY.Render.toArena(clientX, clientY) -> { x, y }
BY.Render.scale()                  -> css px per arena unit
BY.Render.begin(run, save)         // new shift: clear FX, pick the sector look
BY.Render.handle(events, run)      // turn engine events into FX (arcs, sparks, popups, shake)
BY.Render.draw(run, dt, opts)      // dt = real seconds since last frame; opts: { reticle: {x,y}|null, paused }
```
The canvas is fitted "contain": scale = min(cssW/360, cssH/h), centred; outside the arena is yard floor.
Backing store uses devicePixelRatio capped at 2.

### 6.4 UI (shell.html, style.css, ui.js) — DOM for everything that is not the arena
Owns: boot, save/load, the main loop (fixed-step accumulator, max 5 steps per frame, pause when hidden), input,
HUD, all screens. Details in §8.

Test hook (always present, harmless): `BY.UI.debug = { run(), save(), setSave(obj), setInput(fn|null),
timeScale: 1, screen() }` — `setInput(fn)` replaces player input with `fn(run) -> {x,y}`; `timeScale` runs N×
engine steps per frame.

## 7. Visual direction (applies to sprites, renderer and CSS)

**Night shift at a robot scrapyard.** Oxidised teal steel, sodium-lamp hazard yellow, electric cyan for Sprocket's
energy, rust for anything that hurts. One committed dark look (no light theme) — set `color-scheme: dark` on
`:root` and set every colour explicitly.

```css
:root {
  /* layout: a work order clipped over a yard floor — full-bleed arena; the workshop is a scrolling
     circuit-board blueprint with the clock-in button docked in the thumb zone */
  --ink:      #0e1a21;   /* outside the arena, deepest */
  --floor:    #152630;   /* arena floor */
  --plate:    #1d3441;   /* panels */
  --plate-hi: #27475a;   /* raised, borders */
  --line:     #35596e;   /* traces, dividers */
  --text:     #eaf2f4;
  --text-dim: #93adb9;
  --hazard:   #ffc629;   /* the one UI accent: primary buttons, bolts, signage */
  --hazard-ink:#1a1300;
  --arc:      #7fe7ff;   /* Sprocket's energy, selection, arcs */
  --rust:     #e8642c;   /* hostile, danger */
  --core:     #c792ff;   /* cores */
  --ok:       #7ddc6a;   /* healthy battery */
  --steel:    #c5d0d6;   /* bolt metal, robot shells */
  --font-display: "Saira Stencil One", "Arial Black", Impact, sans-serif;       /* stencil yard signage */
  --font-ui: "Chakra Petch", "Trebuchet MS", "Segoe UI", system-ui, sans-serif; /* everything else */
}
```
- Fonts: one Google Fonts link (`Saira Stencil One`, `Chakra Petch` 400;500;600;700). Display face only for the
  logo, screen titles, sector signage and the report stamp. Numbers use `font-variant-numeric: tabular-nums`.
- Type scale (px): 11, 13, 15, 18, 24, 36, 56. Uppercase labels get `letter-spacing: .08em`.
- Subject details to use as real content, not ornament: stencil sector signage ("YARD 9 · SECTOR 02 · CRUSHER
  ROW"), hazard chevrons **only** on the Clock In button edge and the Warden warning band, the blueprint drawn
  as a circuit board with orthogonal copper traces, the shift report as a punched time card with an ink stamp
  ("BATTERY FLAT", "WARDEN SCRAPPED", "CLOCKED OUT"), serial numbers on bots in the codex.
- Do **not** use: emoji anywhere, gradients as decoration, glassmorphism, the same rounded card on every block,
  centred-everything layouts. Corners are tight (2–6 px) or chamfered, like cut sheet metal.
- Arena look: dark floor plates with faint seams and a sector-specific tint/prop pattern (conveyor chevrons,
  crusher teeth along an edge, smelter glow, assembly rails, vault rings). It must stay quiet enough that bots,
  bolts and arcs read instantly. Arcs are jagged cyan lightning with a white core. Bolts are small hex nuts that
  glint. Hostile telegraphs are rust rings/lanes that fill before they land.
- Juice (the player asked for obvious animation in their last game): arcs that visibly connect, hit flashes,
  scrap bursts on kills, bolts vacuumed in with a rising pickup pitch, floating damage numbers (crits bigger,
  hazard yellow), screen shake on slams / Warden hits / low battery, a slow-motion beat and big burst when a
  Warden dies, Overclock tinting the field cyan with afterimages. With reduced motion (`prefers-reduced-motion`
  or the shake setting off): no shake, no slow-motion, fewer particles; nothing essential is lost.
- Performance: must hold 60 fps on a mid-range phone with 26 bots, 150 pickups, 300 particles. No per-frame
  allocations in hot loops where it is easy to avoid; cap particle counts.

## 8. Screens and flow (UI agent)

Phone-first, one-screen app: `html, body { height: 100% }` (never `100vh`), nothing scrolls except the blueprint
and codex/log lists. On wide screens the app is a centred column, max-width 480px, with `--ink` outside.

1. **Title** (first visit only; returning players with `stats.shifts > 0` boot straight into the Workshop).
   Logo "BOLTYARD", one line of premise, a big **CLOCK IN** button, a small sound toggle. Behind it, a live
   attract shift (engine `attract: true`, input on a slow figure-eight) so the first frame already shows the game.
2. **Shift.** Full-bleed canvas. DOM HUD over it:
   - top: battery bar (full width inside the gutter, number of seconds-ish charge left, turns rust and pulses
     under 25%, cyan while Overclock is active), pause button (≥44px target) top-right;
   - under it: bolts collected this shift (left, pops on pickup; cores next to it once any are earned), Warden
     signal meter (right) that fills toward the Warden icon, flashes at full, and **becomes the Warden's name +
     HP bar** while it is active; in sector 5 without Titan it reads "Needs Titan Frame";
   - a small Overclock meter chip (only once unlocked);
   - Warden warning: a hazard-striped band across the screen with the Warden's name for the 2.5 s warning;
   - first shift only: a hint "Drag anywhere to steer Sprocket" with a ghost thumb, gone once the player moves.
   - Bottom third stays empty for the thumb.
   - **Input.** Touch: *relative drag* — touching anywhere and moving shifts the target by the finger delta ×1.3
     (in arena units), starting from `run.player.tx,ty`, so the finger never covers Sprocket. Mouse: target =
     pointer position over the canvas, no button needed. Keyboard: WASD / arrows move the target at 320 u/s;
     Space or Esc pauses. Canvas has `touch-action: none`; the page must not scroll or zoom while playing.
   - Pause sheet: Resume, Clock out (keeps what you collected), sound toggle.
3. **Shift report** (sheet over the frozen arena after a short beat): a time card with the ink stamp for the
   reason, rows for time, bots scrapped, best streak, bolts (count up; show the Yard Sweep bonus on its own row
   if any), cores; a Warden-signal row showing how close they got when the Warden never came; "SECTOR N
   UNLOCKED" when earned; any newly met bots ("New in the codex: Bulwark"). Buttons: **Workshop** and **Clock in
   again**. The primary one is Workshop when something is affordable (label it "Workshop · 3 upgrades ready"),
   otherwise Clock in again.
4. **Workshop** (hub).
   - Header: bolts and cores (count up when they change), settings gear.
   - Sprocket's portrait on a workbench strip (`BY.Sprites.portrait`) beside 3–4 key stats (damage per second,
     battery, field radius, bolt value). It changes as parts are bought. Keep this strip compact.
   - Sector picker: five stencil tiles; locked ones show the lock and what unlocks them; cleared ones a check;
     the selected one is obvious. Sector 5 notes "Needs Titan Frame" until built.
   - **Blueprint**: the upgrade tree as a circuit board, 5 columns × 9 rows from `col,row`, vertical scroll,
     orthogonal traces between nodes (a trace is lit once its parent has a level). Node = icon, level pips or
     "3/25", and state: maxed (solid), affordable (hazard glow, gentle pulse), unlocked but too expensive
     (normal), locked (dim, lock). Tap a node → detail sheet docked above the bottom bar: name, level, what it
     does, `now → next`, cost (bolts / cores, red when short, or the lock reason), **Bolt on** button with
     hold-to-repeat. Buying plays a punch-in animation on the node and a spark along the newly lit traces.
   - Tabs or a segmented control for **Blueprint · Codex · Log**. Codex: bots met so far (portrait, name,
     serial, blurb, hostile tag), unmet ones as dark silhouettes "???". Log: totals from `save.stats`.
   - Bottom dock (thumb zone): **CLOCK IN — SECTOR N** primary button with the hazard-chevron edge.
5. **Victory** (after the Overseer): stamp "YARD 9 SECURED", total shifts and play time, **Keep playing**.
6. **Settings** sheet: Sound, Screen shake, Reset progress (two-step confirmation built into the sheet — the
   viewer blocks `confirm()`/`alert()`), a 3-line how-to-play.

Saving: `localStorage` key `boltyard.save.v1`, every read and write in try/catch; the game must work with storage
unavailable. Save after every purchase, every `endShift`, and every settings change. If the page is hidden
mid-shift, pause; on `pagehide`, `endShift` and save. Also register hot-reload continuity:
`window.claude?.hot?.snapshot(() => ({ save }))` and boot through
`window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {})`.

### Page contract (the built `dist/index.html` must follow this exactly)
- No `<!DOCTYPE>`, `<html>`, `<head>` or `<body>` tags: the host wraps the file. The file starts with
  `<title>Boltyard</title>`, then `<meta name="claude:viewport-fit-sides" content="cover">`, the Google Fonts
  `<link>`, one `<style>`, the markup, then one or more inline `<script>`s. Everything else is inline: no other
  external resources of any kind.
- The host's skeleton pads `:root` top and bottom by the phone's safe-area insets — keep that (do not reset
  `:root` padding). Body margin is 0.
- Text and controls keep a side gutter written `padding-left: max(16px, env(safe-area-inset-left, 0px))` and
  `padding-right: max(16px, env(safe-area-inset-right, 0px))`. The arena canvas and backgrounds may run edge
  to edge. Anything fixed to a screen edge adds that edge's `env(safe-area-inset-*, 0px)` to its padding.
- No `alert`, `confirm`, `prompt`, `window.print`, downloads, `window.open`, or iframes. Sound only after a tap.
- No horizontal page scroll at 320px wide. Tap targets ≥ 44px. Visible keyboard focus. Toggle visibility with
  the `hidden` attribute.
- `tools/build.js` also writes `dist/test.html` = the same content wrapped in the skeleton the host would add
  (doctype, charset, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
  and `<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}
  body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>`), for local tests.

## 9. Pacing targets (Balance agent; everyone else: just don't break them)
Measured with the attentive bot, total *shift* time (workshop time not counted):
- Shift 1 earns 5–10 bolts and lasts ~15 s; the first purchase is possible after shift 1.
- Never more than 3 shifts in a row without being able to afford anything.
- First Compactor kill at 6–10 min; sector 2 cleared by ~22 min, 3 by ~36, 4 by ~50; Titan + Overseer at
  55–75 min; 70–130 shifts in total.
- Typical shift length grows from 15 s to 35–60 s mid-game; hard ceiling ~150 s.
- Each Warden: first summon usually fails; 2–4 attempts typical.
- Core supply matches demand: a normal winning run scraps Wardens 20–30 times in total; cores never sit
  unspendable for long and never wall progress for more than ~3 Warden kills.
- No upgrade is a trap: each one, bought at a sensible time, measurably helps the bot.

## 9b. Notes after wave 1 (engine, sprites and audio are built — these override anything above they conflict with)

**Engine (src/engine.js, src/data.js — done, 10,360 checks passing via `node tools/test-engine.js`):**
- `run.boss`: before the Warden spawns `hp === maxHp` (full); `id` is the Warden type string and `name` is set
  from the start; `enemyId` is `null` until spawn. After death `hp` is 0. `bossSpawn` is not accompanied by `spawn`.
- `oc.time` = seconds remaining while active (0 otherwise); `oc.charge` stays 1 while active, resets to 0 after.
- Contact `hurt` events are aggregated, at most one per 0.2 s. A Fuse exploding on contact emits `explode` +
  `hurt` (src `bomb`) and no `kill`. A Gilded Bot that leaves just disappears (no event).
- After a Warden dies there is a 1.5 s victory window: Sprocket cannot be hurt, drain and spawns stop, floor
  pickups fly in. Then `run.over` with reason `victory`.
- `charge` hazards run from the boss through Sprocket and 120 units beyond; `x,y`→`x2,y2` is the full lane, `w` its width.
- Extra fields exist (shots carry `dmg`; hazards carry `oid, ai, dmg, sp`; enemies carry internals such as `dead`).
  Ignore what you do not need. `enemy.dead === true` bots may linger in the array for a tick — do not draw them.
- `report.bolts` already includes `report.swept`.
- Also exposed: `BY.Engine.cost(save, id)`, `BY.Engine.needFor(save, sector)`, `BY.Engine.spawn(run, type, x, y, opts)`
  (test hook: force-spawn a bot or a Warden), `BY.Autopilot.target(run, {skill})` in `tools/autopilot.js`.
- Hard failsafe: a shift is forced flat at 200 s.

**Sprites (src/sprites.js — done; see `shots/sprites-s1..s7.png`):**
- Wardens and the pylon extend up to ~1.3× past their hit radius; an `invuln` bubble is drawn at 1.45× r. Do not clip.
- Boss `windup` already adds its own jitter inside `enemy()`.
- The Titan sprite is only slightly bigger at the same r — the renderer should draw Sprocket at 1.15× when `player.titan`.
- `portrait()` accepts extra player opts (`titan, oc, hurt, pulse, t`); enemy silhouettes via `{ silhouette: true }`
  come out very dark — put them on `--plate`, not `--floor`.
- `facing` leans Sprocket but does not mirror it.

**Audio (src/audio.js — done):**
- Extra sound names `telegraph` and `shield`; `BY.Audio.isEnabled()`; `unlock()` returns a boolean.
- `handle(events, run)` is silent for `run.attract` shifts. `end` with reason `victory` makes no sound: the UI
  plays `victory` itself on the game-winning report, and `unlock` when a sector unlocks.

**HUD placement (changes §8.2):** the shift HUD is a solid strip *above* the arena canvas, not an overlay, so no
bot is ever hidden behind it. The canvas fills everything below the strip, edge to edge. Only transient things
(Warden warning band, first-shift hint, pause sheet, report sheet) sit over the canvas.

## 9c. Integration notes (Integration + QA pass; these override anything above they conflict with)
Behaviour and contract changes. No balance numbers were touched.
- **Save flags**: `flags.tip` (0-3, first-shift coach step) and `flags.shopped` (first successful purchase) are saved and sanitised in `loadSave`. `newSave` writes both.
- **`E.spawn(run, id, x, y, opt)`** now accepts a Warden id (`compactor`, `shredder`, `furnace`, `foreman`... any `BY.Data.BOSSES` id). It starts the normal warning, then the Warden; if one is already active it returns that enemy. Covered by "spawn hook: Wardens" in test-engine.
- **Text fixes** (data.js `desc`/`fmt` only): amp, surge, chain, overload, capacitor, sweep, lucky, extract, drone, titan and the Bulwark blurb now state what the engine does. test-engine asserts the capacitor, chain and extract strings against `Data` values. The Workshop "Dmg/s" stat includes crits and drones.
- **Yard Sweep** is shown: `endShift` banks the sweep up front (the report is cached and idempotent), `R.sweep(run)` plays rings and sparks, enemies and pickups hide, a "Yard Sweep +N" toast appears and the end beat is 1.3 s (1.0 s without a sweep).
- **HUD**: the signal meter reads "Warden" (mode `near` pulses slowly when close, `full` when a Warden is about to come). The Overclock label stays "OC" while active (glow and full bar show the state) so the Warden label is never truncated. `toast(text, hz, ms)` takes a duration. The Warden arrival toast says "Reserve power +N%".
- **First minute**: title line "Drag to steer. The arc zaps by itself."; a 3-step coach (steer, scrap, battery) stored in `flags.tip`; Workshop pointer ("Tap to upgrade") until the first purchase; branch chips (Arc, Chassis, Salvage, Drones); report has a bold one-line next action (`nextAction()`); Sector 5 and the Titan Frame say the Overseer will not come without the Titan.
- **Workshop header** is a 76 px portrait row plus a 44 px stat row, so 4+ tree rows show at 390x700 and 3+ at 360x640. All text is 12 px or more, taps 44 px or more. `beginShift` ignores a second call while a shift runs.
- **Reduced motion**: OS reduced-motion removes screen shake, slow-mo and half the particles; the in-game Shake switch is separate and shows a note when the OS setting overrides it. The CSS rule no longer leaves toasts at opacity 0.
- **Sprites**: `pickup`, `drone` and `shot` allocate nothing per call. `enemy()` and `player()` still create closures per draw (see perf numbers in the final report). DPR is capped at 2.
- **Tools added**: `lib-page.js`, `play-through.js`, `check-contract.js` (33 checks), `robustness.js` (63 checks), `perf.js`, `shots.js`.

## 9d. Balance pass (overrides the numbers above where they conflict)
- **Source of truth:** `src/data.js` holds the live numbers; the tables in §4 are the original starting values and are now historical.
- **Why:** before this pass the attentive simbot won in ~41 min / 63 shifts (first Compactor 5.5 min, sectors 2/3/4 at 13/23/29 min) — ~35% faster than §9 targets — and finished with ~24 cores unspent.
- **Costs:** every upgrade's bolt base ×1.75 except the three root nodes (Coil Voltage, Power Cell, Magnet), which keep their level-0 price so shift 1 still affords a buy; their growth was raised instead so later levels end up ~×1.75 (coil 1.691→1.731, cell 1.812→1.866, magnet 2.077→2.25).
- **Titan Frame:** 200,000 bolts + 16 cores (was 115,000 + 8) — gives surplus cores a late goal.
- **Wardens:** Furnace Mother hp 4593→4150, Foreman Unit hp 7099→6400 (brings attempts back to ~4).
- **Cores:** Sector 4 Warden repeat kills drop 1 core (was 2). Tried: sector 1 repeat = 0 — rejected, the bot farmed sector 1 endlessly and stalled.
- **Result (attentive bot, 8 games):** win 62m46s (58m52s–71m58s), 90.5 shifts (83–98); first Compactor 7m06s; sectors 2/3/4 cleared at 17m34s / 30m49s / 43m35s; Warden attempts 3.0 / 3.4 / 3.9 / 3.9 / 2.4; shift 1 = 7.4 bolts in 13.1 s, buy possible 100%; dry spell max 2; Warden scraps 29 avg; cores left at win 25.8. Sloppy bot: ~100 min.
- **Known gaps vs §9:** sectors 2–4 still clear ~4–6 min ahead of their targets (the Titan stretch absorbs it); cores still accumulate mid-game because the remaining core nodes are bolt-limited.
- **Test change:** `tools/test-engine.js` amp-cost check now reads `E.cost('amp', 0).bolts` instead of a literal.

## 11. ACT II expansion — build contract (v2). Overrides anything above it conflicts with.

Design rationale lives in the "Boltyard Act II — Expansion Design" doc; this section is the contract. Starting
numbers here are for the Balance agent (wave 3) to tune; contract names (ids, fields, events) are fixed.
**Act I must not change:** sectors 1–5, their bots, Wardens, the 26 Act I upgrades and their numbers stay exactly as
in `src/data.js` now. New mechanics must not draw from the run PRNG unless the player owns them or the bot/attack is
Act II, so Act I replays stay deterministic and `node tools/simbot.js` Act I numbers stay within ±3%.

### 11.1 Flow
- Scrapping the Overseer for the first time sets `save.flags.act2 = true` (alongside the existing `flags.won`).
  Sector 6 unlocks, the R&D nodes stop being classified. Sectors 6–10 unlock one by one like Act I.
- Sector 10's Warden (the Chairman) is blocked until `takeover ≥ 1` (same mechanism as sector 5 / Titan: `boss.blocked`,
  `sectorInfo.lureBlocked`). First Chairman kill sets `save.flags.chairman = true`, `report.act2Won = true`, unlocks
  sector 11 and the two infinite nodes.
- **Sector 11 = Overtime.** `save.overtime = { level: 0, best: 0 }`; `level` = highest Overtime level cleared. Clocking
  into sector 11 always fights level `L = save.overtime.level + 1`. Its Warden is
  `['forklift','firewall','inspector','vp','chairman'][(L - 1) % 5]`. Scaling for level L (applied on top of sector 11's
  base multipliers, which equal sector 10's): enemy hp ×`6^L`, bolts ×`4^L`, hostile damage ×`1.12^L`, Warden hp and
  bolts the same factors, Warden cores `2 + L` (repeat kills of a cleared level are impossible: winning advances).
  `run.overtime = L` (0 outside sector 11); `run.boss.name` stays the Warden's name; the UI adds "Overtime L".
  Winning: `save.overtime.level = L`, `best = max(best, L)`, `report.overtimeLevel = L`, event `overtime { level: L }`.
  The Chairman's `takeover` gate does not apply in Overtime.

### 11.2 Save v2
`v: 2`. `loadSave` accepts v1 and v2 (and junk) and never throws. New/changed fields, all sanitised:
`up` gains the 14 new ids (0); `sectorsCleared` 0–10; `bossKills` keys 1–10; `sector` 1–11 (clamped to unlocked);
`overtime { level ≥ 0 int, best ≥ level }`; `flags.act2` (true if v1 `flags.won` was true), `flags.chairman`,
`flags.reveal` (UI: the Act II reveal has been shown); `stats.act2Shifts`, `stats.act2PlayTime` (null until the
Chairman falls, like `wonShifts`), `stats.stolen` (bolts lost to Repo Bots, lifetime). Upgrade levels for uncapped
nodes are any non-negative integer. Bolt/core totals are plain JS numbers (may exceed 1e15; never `|0` or `Math.round`
them into int32 ops).

### 11.3 Shared number formatter (data.js, Engine agent)
`BY.Fmt.num(n)` → `"999"`, `"1.2K"`, `"34.5M"`, `"6.7B"`, then `T, Qa, Qi, Sx, Sp, Oc, No, Dc`, then `"1.2e36"`.
3 significant digits, no trailing `.0`, negatives with `−`, NaN/Infinity → `"—"`. `BY.Fmt.int(n)` = exact integer with
thin-space thousands below 1e6, else `num`. Every `fmt()`/`desc` string in data.js that prints a cost or big value uses it.
UI, render and sprites call `BY.Fmt.num` for every bolt, core, damage and HP number they show.

### 11.4 Sectors 6–11 (starting values)
| n | name | hp× | bolts× | dmg× | need | cap | Warden | cores first / repeat | mix (weights) |
|---|---|---|---|---|---|---|---|---|---|
| 6 | Loading Dock B | 1500 | 300 | 3.5 | 60 | 24 | forklift | 6 / 2 | scrapling 6, roller 10, sparker 14, shieldbot 14, hauler 10, splitter 10, bomber 12, turret 10, repo 10, printer 6 |
| 7 | Server Farm | 2e4 | 2500 | 4.5 | 70 | 25 | firewall | 7 / 2 | roller 8, sparker 12, shieldbot 14, hauler 10, splitter 10, bomber 12, turret 8, repo 8, printer 6, laser 8, firenode 4 |
| 8 | Quality Control | 3e5 | 2.5e4 | 5.5 | 80 | 26 | inspector | 8 / 3 | sparker 12, shieldbot 12, hauler 8, splitter 8, bomber 12, turret 8, repo 8, printer 6, laser 8, firenode 5, auditor 8, mimic 4 |
| 9 | Executive Elevator | 5e6 | 2.5e5 | 7 | 90 | 26 | vp | 10 / 3 | sparker 12, shieldbot 12, hauler 8, splitter 6, bomber 12, turret 8, repo 10, printer 6, laser 10, firenode 5, auditor 10, mimic 5 |
| 10 | The Boardroom | 1e8 | 3e6 | 9 | 100 | 26 | chairman | win / 3 | as sector 9 |
| 11 | Overtime | 1e8 | 3e6 | 9 | 90 | 26 | rotation (11.1) | 2+L / – | as sector 9 |
Elites (×4) and Gilded Bots continue in every sector.

### 11.5 New rogue bots (sector-6 base values; × sector multipliers like Act I)
| id | name | serial | hp | r | speed | bolts | signal | behaviour | hostile | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| repo | Repo Bot | REPO-11 | 10 | 12 | 70 | 4 | 2 | `repo` | contact | chases; on first contact steals `5%` of `run.earned.bolts` (min 1, stored on `e.stolen`), emits `steal`, then flees (`flee` behaviour, leaves after 6 s carrying the bolts → lost, added to `stats.stolen`). Killed while carrying: drops `1.5 × e.stolen` extra bolts + event `refund { x, y, bolts }`. No contact damage. |
| printer | Pallet Printer | PRT-4 | 40 | 16 | 0 | 8 | 3 | `printer` | – | static after entering (walks to a spot like `plant`); armor 0.5; every 4 s spawns 2 `mite` beside it (counts toward maxAlive) + event `print { enemyId }`. |
| laser | Laser Drone | LZR-3 | 14 | 12 | 40 | 6 | 3 | `laser` | lane | `plant`, then every 3.5 s a laser hazard aimed through Sprocket's position (windup 0.9 s, fire 0.5 s, width 14, 4 dmg/s while firing). |
| firenode | Firewall Node | FWN-0 | 60 | 14 | 0 | 10 | 3 | `firenode` | – | static after entering; every other bot within 90 (not Wardens, not other nodes) gets `invuln = true` and `shieldedBy = node id` while the node lives. |
| auditor | Auditor | AUD-8 | 22 | 12 | 0 | 8 | 3 | `auditor` | slam | every 3 s: `blink` hazard (0.5 s) at a random point 60–120 from Sprocket, teleports there, then a slam hazard r 34, windup 0.8, 4 dmg on Sprocket's position. |
| mimic | Mimic | MMC-6 | 30 | 10 | 75 | 24 | 2 | `mimic` | contact | spawns `disguised = true`, motionless, collision with arcs off (not targetable) until Sprocket is within 40, then `disguised = false`, event `mimicWake`, chases, contact 4/s. |

New enemy fields read by renderer/sprites: `disguised`, `shieldedBy` (id or null), `stolen` (bolts carried, 0), `infected` (seconds of nanites left, 0).

### 11.6 New Warden attacks and moves
Attack entries (data.js) gain these kinds; all telegraph through `run.hazards`:
- `barrage { every, n, r, windup, gap, spread, dmg }`: n slam hazards, the i-th centred at Sprocket's position + a random
  offset ≤ `spread`, each starting `gap × i` seconds after the first. Grid variant: `pattern: 'grid'` lays n slams on a
  3-wide grid centred on Sprocket (`spread` = cell size).
- `laser { every, n, windup, fire, w, dmg, fan }`: n laser hazards from the boss through Sprocket's position, rotated by
  `fan` radians apart (centred). Hazard: `{ kind: 'laser', x, y, x2, y2, w, t, dur, fire, firing }` — `x,y` boss end,
  `x2,y2` clipped to the arena edge; `firing` true for `fire` seconds after `t >= dur`; hurts `dmg × sector dmg ×
  (1 − plating)` per second while Sprocket's circle overlaps the lane. Removed after firing.
- `budget { perSec, phases }`: an aura, not a timer: while the boss is alive and in a listed phase, battery drain
  += `perSec` (× sector dmg, not reduced by plating). `run.player.budget = true` while active; events `budget { on }`.
- `move: 'blink'` with `blink: { every, windup }`: hazard `{ kind: 'blink', x, y, r: boss r, t, dur }` at a spot
  80–160 from Sprocket inside the arena; boss invulnerable and untouchable while blinking; reappears there. Event
  `blink { enemyId, x, y }` when it lands. Phase-limited moves: `moveByPhase: { 4: 'blink' }` (Chairman).
- `shields` may name `pylonType: 'firenode'` (Firewall) instead of the default pylon; count via `pylons: 4`.

### 11.7 New Wardens (absolute numbers; damage × sector dmg × (1 − plating))
| id | name | serial | hp | r | move | contact | bolts | attacks |
|---|---|---|---|---|---|---|---|---|
| forklift | The Forklift | WRD-6 | 1.2e6 | 34 | chase 34 | 6 | 3e7 | charge every 3.2 (windup 0.9, speed 480, dmg 8); barrage every 6 (n 3, r 46, windup 0.9, gap 0.3, spread 70, dmg 7); summon printer ×2 every 12 |
| firewall | The Firewall | WRD-7 | 1.5e7 | 40 | static top | 0 | 3e8 | ring every 2.6 (n 16, speed 95, dmg 6); laser every 5 (n 2, windup 1.0, fire 0.6, w 18, dmg 10/s, fan 0.6); shields [0.7, 0.35] pylonType firenode, pylons 4 |
| inspector | The Inspector | WRD-8 | 2.5e8 | 30 | blink every 5 (windup 0.7) | 6 | 3e9 | barrage every 5.5 (pattern grid, n 6, r 40, windup 1.0, gap 0.12, spread 72, dmg 8); summon auditor ×2 every 9 |
| vp | The Vice President | WRD-9 | 4e9 | 36 | chase 26 | 7 | 4e10 | phases [1: cadence 1, 0.5: cadence 0.85]; laser every 4.5 (n 1, windup 0.8, fire 0.6, w 16, dmg 12) phases 1,2; summon repo ×3 every 8 phases 1,2; ring every 4 (n 12, speed 105, dmg 7) phase 2; budget perSec 0.6 phase 2 |
| chairman | The Chairman | WRD-10 | 1e11 | 44 | chase 20; blink in phase 4 (every 4, windup 0.6) | 8 | 0 | phases [1: 1, 0.75: 1, 0.5: 1, 0.25: cadence 0.6]; P1: slam every 3 (r 66, windup 1.0, dmg 9) + summon sparker ×3 every 8; P2: charge every 3.6 (windup 0.8, speed 480, dmg 10) + laser every 5 (n 3, fan 0.5, windup 0.9, fire 0.5, w 16, dmg 12); P3: ring every 3.4 (n 14, speed 110, dmg 8) + barrage every 6 (n 5, r 44, windup 0.9, gap 0.2, spread 90, dmg 9), shield once at 0.5 (pylons 3); P4: every P1–P3 attack + budget perSec 1.0 |
Each has a one-line `blurb` (dry workplace tone) like Act I Wardens.

### 11.8 R&D upgrades (branch `rnd`, all `gate: 'act2'` unless noted)
`gate` = a save flag (`'act2'` or `'chairman'`) that must be true; until it is, `upgradeInfo` returns
`classified: true`, `unlocked: false`, `lockReason: 'Classified'`, `name: 'CLASSIFIED'`, `desc: ''`, `now/next: null`,
and the node is still positioned (UI draws a redacted plate). `max: Infinity` = uncapped: `upgradeInfo.max = null`,
`maxed = false` forever, `fmt` handles any level.
| id | name | col,row | max | base, growth | cores per level | requires | effect per level |
|---|---|---|---|---|---|---|---|
| fusion | Fusion Coil | 1,9 | 10 | 1.5e6, 6 | 2,2,3,3,4,4,5,5,6,6 | titan 1 | arc damage ×2 |
| supercell | Supercapacitor | 2,9 | 8 | 2e6, 4 | – | titan 1 | max battery +25%, heat sag −5% (multiplicative with coolant) |
| dividends | Dividends | 3,9 | 10 | 1e6, 5 | – | titan 1 | bolt value ×1.5 |
| lattice | Tesla Lattice | 4,9 | 5 | 4e6, 9 | 2,0,2,0,3 | titan 1, drone 2 | links Sprocket↔each drone and drone↔next drone; bots touching a link (within 8 of the segment) take `2 × lattice × droneDmg` per second |
| storm | Storm Coil | 0,10 | 5 | 5e6, 9 | 2,0,2,0,3 | fusion 1 | every `9 − storm`th pulse is a storm: every living, targetable bot takes `3 × damage` (crit rules apply, armor ignored) |
| singularity | Singularity | 1,10 | 5 | 8e6, 10 | 2,1,2,2,3 | fusion 1 | every `11 − singularity` s a well opens on the densest bot cluster (radius 90): pulls bots (speed 160) and pickups for 1.5 s, then implodes for `(10 + 10 × singularity) × damage` to bots within 90 |
| severance | Severance Package | 2,10 | 3 | 1.2e7, 15 | 2,3,4 | supercell 1 | once per shift, when the battery would end the shift (after Spare Cell): blast r 140 for `50 × damage`, then every pickup on the floor is collected at ×[1.5, 2, 2.5]; then the shift ends (`reason: 'battery'`, `report.severance = true`) |
| stockopt | Stock Options | 3,10 | 5 | 3e6, 8 | – | dividends 1 | each time the combo reaches a multiple of 10: shift bolt multiplier += `0.02 × stockopt` (applies to pickups collected after; cap +100% × stockopt) |
| rehire | Hostile Rehire | 4,10 | 5 | 6e6, 9 | 1,1,1,2,2 | lattice 1 | each scrapped non-Warden bot: `3% × rehire` chance to spawn an Intern (allied, life 6 s, r 9, speed 150, homes on nearest bot, contact `2 × damage`/s); max 4 alive |
| nanites | Nanite Swarm | 0,11 | 5 | 2e7, 9 | 2,1,2,2,3 | storm 1 | arc hits set `infected = 4` s; infected bots take `0.1 × nanites × damage`/s; an infected bot scrapped infects bots within 60; max 40 infected |
| parachute | Golden Parachute | 3,11 | 3 | 1e7, 20 | – | stockopt 1, sweep 2 | Yard Sweep collects ×[1.5, 2, 3] of the floor bolts (replaces 100%) |
| takeover | Hostile Takeover | 2,12 | 1 | 5e10, 1 | 40 | fusion 5, severance 1, parachute 1, rehire 1, nanites 1 | Sprocket becomes the **Colossus**: damage ×10, battery ×2, field ×1.3; lures the Chairman |
| overtimepay | Overtime Pay | 1,13 | ∞ | 1e11, 2.2 | – | takeover 1 (gate `'chairman'`) | damage ×1.3 |
| hazardpay | Hazard Pay | 3,13 | ∞ | 1e11, 2.2 | – | takeover 1 (gate `'chairman'`) | bolt value ×1.3 |
Each has `desc` and `fmt(level)` like Act I. Blueprint grows to 5 columns × 14 rows; R&D traces hang from `titan`.

Derived stats additions (extend §4.3, in this order): `damage ×= 2^fusion × (takeover ? 10 : 1) × 1.3^overtimepay`;
`boltMult ×= 1.5^dividends × 1.3^hazardpay`; `maxBattery ×= (1 + 0.25·supercell) × (takeover ? 2 : 1)`;
`sag ×= 1 − 0.05·supercell`; `radius ×= takeover ? 1.3 : 1`; new stats `stormEvery` (0 = off), `latticeDps`,
`wellEvery`, `wellMult`, `severancePct` (0 = off), `stockStep`, `rehireChance`, `naniteDps`, `colossus` (bool).
`sweepPct` = parachute ? [1.5, 2, 3][parachute − 1] : (existing). `loadout(save)` gains `rnd` tier 0–3 (total R&D
levels: 0 / ≥1 / ≥15 / ≥35) and `colossus`.

### 11.9 Run state additions (renderer/HUD read these; names fixed)
`run.overtime` (0 or L); `player.colossus`, `player.budget` (bool); `run.pulses` (count, for storm cadence);
`run.interns: [{ id, x, y, vx, vy, age, life }]`; `run.wells: [{ id, x, y, r, t, pull, phase }]` (`phase` 'pull' |
'boom'); `run.links: [{ x1, y1, x2, y2 }]` (lattice segments this tick, empty if not owned); `run.stock: { n, mult }`
(n = bonuses earned, mult = current bolt multiplier from Stock Options, starts 1); enemy fields in 11.5; hazard kinds
`laser`, `blink` (11.6). `run.boss.overtime` = L or 0.

### 11.10 New events (exact `type` strings)
```
storm     { n }                         a storm pulse hit n bots
wellOpen  { id, x, y, r }               wellBoom { id, x, y, r, n }
intern    { id, x, y }                  an Intern rebooted        internEnd { id, x, y }
infect    { enemyId }                   nanites jumped to a bot (rate-limit in consumers)
severance { x, y, r, bolts }            the Severance blast + payout
stock     { n, mult }                   Stock Options step
steal     { enemyId, x, y, bolts }      refund { x, y, bolts }      print { enemyId }
blink     { enemyId, x, y }             mimicWake { enemyId }
laser     { x, y, x2, y2, w }           a laser started firing
budget    { on }                        overtime { level }
```
`telegraph` also fires for `laser`, `blink` and each `barrage` slam. Report additions: `act2Won`, `overtimeLevel`
(number | null), `severance` (bool), `stolen` (bolts lost this shift), `stockMult`.

### 11.11 Sprites (wave 1)
`BY.Sprites.enemy` draws the 6 new bots (Mimic while `disguised` looks like a bolt pickup at 1.3× size with a slow
wobble and one tell, e.g. a blinking eye slit) and the 5 new Wardens (Chairman ≈ a hulking boardroom chair-mech; each
Warden recognisable at a glance). `player()` honours `o.colossus` (renderer draws it at 1.3× r; much heavier, gold
trim on the steel). New: `BY.Sprites.intern(ctx, x, y, r, t)` (small friendly bot, cyan visor, lanyard),
`BY.Sprites.well(ctx, w, t)` optional (renderer may draw wells itself). Icons: the 14 new upgrade ids plus
`classified, overtime, colossus, repo`. Portrait handles `colossus`. Codex portraits for every new enemy.

### 11.12 Audio (wave 1)
New names: `laser, storm, well, wellBoom, steal, refund, intern, severance, overtime, budget, blink, print, mimic,
classified` (the reveal sting). `handle()` maps: laser→laser, storm→storm (rate-limit 0.25 s), wellOpen→well,
wellBoom→wellBoom, steal→steal, refund→refund, intern→intern (rate-limit), severance→severance, overtime→overtime,
budget{on:true}→budget, blink→blink, print→print (quiet, rate-limited), mimicWake→mimic. `infect`, `stock` silent
(or a very soft tick, rate-limited). Same never-throw and budget rules as §6.2.

### 11.13 Render and UI (wave 2 — briefs will follow; listed so wave 1 builds the right hooks)
Render: laser lanes (rust telegraph → white-hot beam), barrage circles, blink markers, firenode cyan links to shielded
bots, Repo Bot carrying a bolt sack, storm (screen-wide forked arcs), lattice links (cyan beams), wells (swirl + implosion),
interns, nanite green flecks on infected bots, Severance blast, Colossus at 1.3×, budget-cut red vignette, sector looks
6–11, big-number popups via `BY.Fmt`. UI: sector picker for 11 sectors, `BY.Fmt` everywhere, CLASSIFIED plates, the Act II
reveal (victory card second stamp "MANAGEMENT HAS NOTICED"), Chairman card "UNDER NEW MANAGEMENT", Overtime level in
sector tile/HUD/report/log, uncapped node level text ("LV 37"), save v2.

### 11.14 Pacing targets for Act II (Balance agent, wave 3)
Measured from the first Overseer kill with the attentive bot: sector 6 cleared by ~+10 min, 7 by ~+22, 8 by ~+35,
9 by ~+48, Chairman at +60–75 min; 60–100 Act II shifts; each Act II Warden 2–4 attempts; never more than 3 shifts in a
row with nothing affordable; Overtime levels 1–5 take 2–5 shifts each once caught up; shift length ceiling stays ~150 s.

### 11.15 Board fatigue (catch-up rule, added after the Act II balance pass)
Act II Wardens only (sectors 6–10; not Act I, not Overtime). `save.fatigue = { 6..10: fraction }`; a failed shift in
which that sector's Warden was summoned adds `TUNE.fatiguePer` (0.06), capped at `TUNE.fatigueMax` (0.36); a kill resets
it to 0. At spawn the Warden's hp/maxHp and its shield pylons' hp are × `(1 − fatigue)`. Exposed as `run.boss.fatigue`,
`sectorInfo(save, n).fatigue`, `report.fatigue` and `report.fatigueUp`. UI shows it on the sector info line
("Board fatigue −18%") and on the shift report when it rises. Why: the attentive bot beats the Chairman in ~3 attempts
but the sloppy bot needed 33 (worst 79); fatigue helps players who are stuck without slowing anyone who isn't.
Also from the balance pass: Takeover battery is ×1.3 (not ×2), Fusion Coil is ×3 per level, Overtime HP ×8 per level.

## 12. ACT III expansion "Head Office" + refined Blueprint — build contract (v3). Overrides anything above it conflicts with.

**Why.** Act I ≈ 63 min and Act II ≈ 58 min (attentive bot). Act III adds ≈ 60 min so a fresh save reaches the finale in
≈ 3 h. Same recipe as Act II: a reveal, five sectors with one new threat each, five Wardens, a tree of new verbs that is
CLASSIFIED until the act opens, a capstone form that gates the finale, Board fatigue as the catch-up rule, endless
Overtime after. Story: the Chairman reported to someone. Head Office would like a word. At the top is **the Founder**,
who built Yard 9 from scrap, then the company, then Sprocket.
**Frozen:** Act I and Act II rules and numbers. `simbot.js --runs 8 --quiet` (Act I) and `simbot.js --act2` up to the
Chairman must give identical results. New mechanics never draw from the run PRNG unless the player owns them or the
bot/attack is Act III. `src/data.js` numbers are the source of truth (they already differ from §11's first tables).

### 12.1 Flow
- First Chairman kill (`flags.chairman`, existing) now also sets `flags.act3 = true`: sector 11 (Lobby) unlocks and the
  Executive Suite nodes stop being classified. Sectors 11–15 unlock one by one.
- Sector 15's Warden (the Founder) is blocked until `stake ≥ 1` (same `boss.blocked` / `lureBlocked` mechanism).
  First Founder kill sets `flags.founder = true`, `report.act3Won = true`, unlocks sector 16.
- **Overtime moves to sector 16** (`NSEC = 16`); it unlocks after the Founder, not the Chairman. Base multipliers =
  sector 15's. Rotation (10): `forklift, receptionist, firewall, counsel, inspector, comptroller, vp, market, chairman,
  founder`. **Warden hp and bolts are normalised:** every Overtime Warden uses the Founder's base hp/bolts × the level
  factors (fixes "rotation varies a lot in difficulty"); its own attacks/moves/look. Level factors, cores (2 + L) and
  `overtime` event unchanged. Overtime Pay / Hazard Pay keep gate `'chairman'` (they are the always-available sink).
- Board fatigue (§11.15) extends to sectors 11–15 (same numbers, `save.fatigue` keys 11–15). Not Overtime.

### 12.2 Save v3
`v: 3`. `loadSave` accepts v1/v2/v3/junk, never throws. `up` gains the 11 ids in 12.8 (0). `sectorsCleared` 0–15,
`bossKills` 1–15, `sector` 1–16 clamped to unlocked. Flags: `act3` (= true if a v2 save had `chairman`), `founder`,
`reveal3` (UI: Act III reveal shown), `finale` (UI: Founder card shown). Stats: `act3Shifts`, `act3PlayTime` (null until
the Founder falls), `clawed` (bolts lost to clawback, lifetime). A v2 save with `sector: 11` (old Overtime) loads as
sector 11 = Lobby; its `overtime` progress is kept and resumes at sector 16 after the Founder.

### 12.3 Sectors 11–16 (starting values; Balance tunes. Sector 10 now: hp 4e8, bolts 3e6, dmg 24, need 300)
| n | name | hp× | bolts× | dmg× | need | Warden | cores first/repeat | new in mix |
|---|---|---|---|---|---|---|---|---|
| 11 | The Lobby | 2e10 | 4e7 | 28 | 300 | receptionist | 8 / 3 | spam 14, courier 6 (+ sector-10 mix scaled to 70%) |
| 12 | Legal | 8e11 | 5e8 | 32 | 320 | counsel | 9 / 3 | + paralegal 10 |
| 13 | Accounting | 3e13 | 6e9 | 37 | 340 | comptroller | 10 / 4 | + copier 8 |
| 14 | The Trading Floor | 1e15 | 8e10 | 42 | 360 | market | 12 / 4 | + hr 8, courier 10 |
| 15 | Head Office | 4e16 | 1e12 | 48 | 380 | founder | win / 4 | all of the above |
| 16 | Overtime | = 15 | = 15 | = 15 | 1000 | rotation | 2+L / – | as 15 |
Elites and Gilded Bots continue. `cap` 26.

### 12.4 New rogue bots (sector-11 base values, × sector multipliers)
| id | name | serial | hp | r | speed | bolts | signal | behaviour |
|---|---|---|---|---|---|---|---|---|
| spam | Spam | SPM-0 | 2 | 6 | 95 | 1 | 0.25 | arrives as a burst of 8 from one edge in a loose wedge (one spawn roll = 8 bots; may exceed cap by 8), chases, contact 1/s |
| courier | Courier Drone | CRR-2 | 12 | 10 | 150 | 30 | 2 | enters on an edge, flies a straight line to the far edge and leaves (no reward, no penalty). Not hostile. A fast, rich target |
| paralegal | Paralegal | PLG-5 | 20 | 12 | 50 | 8 | 3 | `plant`; every 5 s files an injunction on Sprocket's position (hazard 12.5) |
| copier | Photocopier | CPY-9 | 36 | 15 | 0 | 10 | 3 | `plant`, armor 0.3; every 5 s copies the nearest non-Warden non-copier bot within 140: same type at 60% hp, `copy: true`, drops 50% bolts, 0 signal. Max 12 copies alive. Event `copy { enemyId, srcId }` |
| hr | HR Rep | HRR-1 | 26 | 12 | 55 | 9 | 3 | keeps 100–160 from Sprocket; heals every other bot within 110 by 4% max hp/s (Wardens 0.5%/s). Segments in `run.heals` |
New enemy fields: `copy` (bool), `healing` (bool).

### 12.5 New Warden attack kinds (data.js `attacks`, all telegraph through `run.hazards`)
- `hold { every, n, r, windup, spread, stun, dmg }` "Please hold": n circles at Sprocket's position + offset ≤ spread.
  On fire, if Sprocket is inside: `player.held = stun` (no movement while > 0; arc still fires) and dmg. Hazard
  `{ kind: 'hold', x, y, r, t, dur }`. Event `hold { x, y, r }` when it catches Sprocket.
- `injunction { every, n, r, windup, life }`: first on Sprocket, the rest at random points ≤ 120 from it. Hazard
  `{ kind: 'injunction', x, y, r, t, dur, life, active }` (`active` after windup, removed after `life` s). While
  Sprocket's centre is inside an active one, `player.enjoined = true` and **arc pulses do not fire** (drones, lattice,
  storm, wells, orbital, interns still work). Max 4 active per run. Event `injunction { x, y, r }` when it activates.
- `clawback { every, pct }`: moves `pct × run.earned.bolts` into `run.boss.clawed`; event `clawback { bolts }`. On the
  Warden's death the clawed bolts drop as pickups ×1.5 (event `refund`). If the shift ends first they are lost
  (`stats.clawed`, `report.clawed`).
- `volatility { period, lo, hi }`: the Warden's damage taken × `m(t)`, a sine between lo and hi. `run.boss.vol` = m.
- `aura { r, dps }`: hurts Sprocket per second while within r of the Warden (× sector dmg × (1 − plating)).
  `run.boss.aura = r` (0 if none).
- `summon` may name `spam` (spawns one burst per count).

### 12.6 New Wardens (absolute hp/bolts: Balance sets them; start at the Chairman's ratio to its sector, scaled to each sector)
| id | name | serial | r | move | contact | attacks |
|---|---|---|---|---|---|---|
| receptionist | The Receptionist | WRD-11 | 32 | drift 30 | 6 | hold every 4 (n 3, r 40, windup 1.0, spread 80, stun 0.8, dmg 6); ring every 3 (n 12, speed 100, dmg 6); summon spam ×2 every 10 |
| counsel | The General Counsel | WRD-12 | 34 | chase 24 | 7 | injunction every 6 (n 3, r 50, windup 0.8, life 6); laser every 5 (n 2, fan 0.4, windup 0.9, fire 0.5, w 16, dmg 12); summon paralegal ×2 every 12 |
| comptroller | The Comptroller | WRD-13 | 40 | static top | 0 | clawback every 6 (pct 0.04); barrage every 5 (grid, n 6, r 40, windup 1.0, gap 0.12, spread 72, dmg 9); summon copier ×1 every 14; shields [0.6] pylons 3 |
| market | The Market | WRD-14 | 40 | chase 30 | 8 | phases [1: bull, 0.5: bear]; volatility always (period 6, lo 0.25, hi 2.5); P1 charge every 2.6 (windup 0.7, speed 560, dmg 10); P2 slam every 2.8 (r 70, windup 0.9, dmg 11) + ring every 3.5 (n 14, speed 110, dmg 8); summon courier ×3 every 9 |
| founder | The Founder | WRD-15 | 46 | chase 22; blink in P2 and P5 | 9 | phases [1, 0.8, 0.6, 0.4, 0.2 (cadence 0.7)]. P1 echoes Act I: slam + charge + ring. P2 Act II: laser fan 3 + grid barrage + blink. P3 Act III: hold + injunction + clawback. P4: aura (r 90, dps 10) + summon hr ×2 and spam. P5: everything from P1–P4 |
Blurbs (dry): Receptionist "Your call is important to us. Please continue to hold." · Counsel "Objects to everything.
Sustained." · Comptroller "Has found an error in your favour. Correcting it." · Market "Up 4%. Down 6%. Nobody knows
why." · Founder "Built Yard 9 out of scrap. Then built a company. Then built you."

### 12.7 Derived stats additions (extend §4.3/§11.8, in this order)
`damage ×= 3^megacoil × (stake ? 10 : 1)`; `wardenMult = 1.8^diligence` (all damage to Wardens and their pylons);
`critChance += 0.03·insider`, `critMult += 0.5·insider`; `boltMult` unchanged (compound is per-shift, below);
`maxBattery ×= stake ? 1.25 : 1`; `radius ×= stake ? 1.15 : 1`; `drones = droneBay + fleet`, `droneDmg ×= 2^fleet`;
new stats `holdMult = 0.7^legal`, `injunctionR = 0.8^legal`, `clawMult = 0.75^legal`, `compoundStep`, `orbitalEvery`
(0 = off), `orbitalMult`, `expenseStep`, `expenseCap`, `burstChance`, `internLife`, `internMax`, `internMult`,
`magnate` (bool). `loadout(save)` gains `exec` tier 0–3 (total Executive levels 0 / ≥1 / ≥12 / ≥28) and `magnate`.

### 12.8 Executive Suite (branch `exec`, all `gate: 'chairman'`). Blueprint becomes 5 columns × 17 rows.
| id | name | col,row | max | cores per level | requires | effect per level |
|---|---|---|---|---|---|---|
| megacoil | Megacoil | 0,14 | 8 | 3,3,4,4,5,5,6,6 | takeover 1 | arc damage ×3 |
| diligence | Due Diligence | 1,14 | 5 | 2,3,4,5,6 | takeover 1 | damage to Wardens ×1.8 |
| legal | Legal Team | 2,14 | 3 | – | takeover 1 | hold stun −30%, injunction radius −20%, clawback −25% (multiplicative) |
| compound | Compound Interest | 3,14 | 5 | – | takeover 1 | bolt value +4% per 10 s survived this shift, cap +60% (per level). `run.compound` = current × |
| fleet | Drone Fleet | 4,14 | 3 | 3,4,5 | takeover 1, drone 4 | +1 drone; drone damage ×2 |
| insider | Insider Trading | 0,15 | 5 | – | megacoil 1 | crit chance +3%, crit multiplier +0.5 |
| orbital | Orbital Office | 1,15 | 5 | 2,0,3,0,4 | diligence 1 | every `13 − 2·orbital` s a strike marks the highest-hp bot (Wardens count; windup 0.6) and hits it for `25·orbital × damage × wardenMult` + 30% splash r 50 |
| expense | Expense Account | 2,15 | 3 | – | legal 1 | each scrap while combo ≥ 20 refunds `0.04·expense` s battery; max `+12·expense` s per shift |
| restructure | Restructuring | 3,15 | 5 | 2,0,2,0,3 | compound 1 | each scrapped non-Warden bot: `4%·level` chance to burst r 60 for `8 × damage`; bursts chain; max 8 bursts/s |
| outsource | Outsourcing | 4,15 | 3 | – | fleet 1, rehire 1 | Interns: life +3 s, max alive +2, contact ×2 |
| stake | Majority Stake | 2,16 | 1 | 60 | megacoil 4, orbital 1, restructure 1, insider 1, expense 1, outsource 1 | Sprocket becomes the **Magnate**: damage ×10, battery ×1.25, field ×1.15; lures the Founder |
Bolt costs: Balance sets (Act III must pace like Act II; the node set should keep cores from piling up: target ≤ 30
spare cores at the Founder). Each node has `desc` (dry tone) and `fmt(level)`.

### 12.9 Run state additions (names fixed)
`player.held` (s), `player.enjoined` (bool), `player.magnate` (bool); `run.heals: [{ x1, y1, x2, y2 }]`;
`run.strikes: [{ id, x, y, r, t, dur, targetId }]` (orbital markers); `run.compound` (multiplier, starts 1);
`run.expense` (s refunded so far); `run.clawed` (bolts lost this shift); `boss.clawed`, `boss.vol` (1 if none),
`boss.aura` (0 if none); hazard kinds `hold`, `injunction`; enemy fields in 12.4.

### 12.10 New events (exact `type` strings)
```
hold       { x, y, r }            caught by a hold          injunction { x, y, r }   an injunction became active
clawback   { bolts }              copy       { enemyId, srcId }
orbital    { x, y, r, n }         strike landed, n bots hit burst { x, y, r, n }  a Restructuring burst
founder    { phase }              Founder phase line (UI may show one dry line per phase)
```
`telegraph` also fires for `hold`, `injunction` and orbital markers. Report additions: `act3Won`, `clawed`, `compound`
(final ×), `expense` (s).

### 12.11 Sprites, audio
Sprites: the 5 bots and 5 Wardens (Receptionist ≈ desk-mech with headset; Counsel ≈ gavel-armed briefcase walker;
Comptroller ≈ abacus/ledger tower; Market ≈ two-faced bull/bear mech, face swaps with phase; Founder ≈ a huge, weathered
first-generation Sprocket made of yard scrap with a crown of welded bolts). `player()` honours `o.magnate` (black-and-gold
plating, pinstripe, tie-shaped heat vent; renderer draws at 1.4× r; magnate wins over colossus). Icons: the 11 new ids
plus `exec`, `founder`, `stake`, `hold`, `injunction`. Portrait handles `magnate`. Codex portraits for every new enemy.
Audio names: `hold, injunction, clawback, orbital, burst, copy, memo` (Act III reveal sting), `founder` (finale sting).
`handle()` maps hold→hold, injunction→injunction, clawback→clawback, orbital→orbital, burst→burst (rate-limit 0.12 s),
copy→copy (quiet, rate-limited), founder→ silent (UI plays `founder` on the finale card). Never-throw rules as §6.2.

### 12.12 Render and UI
Render: hold rings (rust telegraph → cyan "on hold" clamp around Sprocket while held), injunction seals (red wax-seal
circle; Sprocket's arc ring greys out while enjoined), clawback (bolts stream from HUD toward the Comptroller), HR heal
links (soft green), copy flash + copies drawn with a faint scanline/greyed tint, couriers with a motion streak, spam as
tiny envelopes, orbital marker (thin crosshair ring, then a vertical beam), Restructuring bursts, Market volatility ticker
over the Warden (▲/▼ and ×m), Founder aura ring, Magnate at 1.4×, sector looks 11–15 (lobby marble, legal wood panelling,
accounting green ledger grid, trading floor tickers, head office night skyline).
UI: sector picker for 16 sectors that stays no taller than today's two rows (e.g. act tabs I / II / III + OT, or a
grouped horizontal strip); CLASSIFIED Executive plates; Act III reveal on the Chairman card (second stamp "HEAD OFFICE
WOULD LIKE A WORD"); Founder finale card ("FOUNDER'S DAY" stamp, line "Sprocket is the company now."), then Overtime;
`act3` totals in the log; Board fatigue line for 11–15; report rows for clawed / compound / expense when non-zero.

**Refined Blueprint (the upgrade screen) — "executive-grade industrial".** Same palette and fonts, more craft:
1. Nodes: machined bolt-head plates (bevel from layered gradients: top-left highlight, bottom-right shade, inset
   shadow), engraved icon. A thin level track around each plate replaces pips: segmented for max ≤ 12, continuous arc
   above that, "LV n" chip for uncapped. States: locked (matte, desaturated, lock glyph), affordable (amber rim + slow
   2.4 s breathing glow on a pseudo-element's opacity), owned (brushed steel), maxed (gold-anodised, tiny engraved check),
   classified (clean redacted plate). Each branch gets a 2 px rim accent colour (arc, chassis, salvage, drones, R&D, exec).
2. Traces: circuit-board style with rounded corners; lit traces between owned nodes glow and carry a slow "current"
   (dash offset animation); locked traces dim and dashed. All motion off under reduced motion.
3. Section header plates: "ACT I · THE YARD", "ACT II · R&D", "ACT III · EXECUTIVE SUITE", each with a slim progress
   bar (capped levels owned / total) and count; classified sections show a redacted header.
4. Sticky jump bar at the top of the Blueprint pane: chips I / II / III (with a dot when something there is affordable)
   that scroll to the section.
5. Detail sheet: elevated card (gradient, 1 px top highlight, shadow), 48 px icon plate, name in the display font, branch
   chip, segmented level bar, "Now → Next" as two tiles, requirements list with ✓ / ✗ when locked, cost row per currency
   with an affordability meter ("78% · 1.6B short"), primary "Bolt on" plus secondary "Max" (buys every level you can
   afford, one tap; most useful on uncapped nodes). Slides up 220 ms ease-out.
6. Purchase feedback: the level track fills with a quick spark; nodes that just became affordable flash once.
7. Workshop header: stat tiles with tabular numbers and small-caps labels; currency counts tick when they change.
8. Performance and access: transforms/opacity only for animation; scroll at 60 fps with all 52 nodes; touch targets
   ≥ 44 px; text contrast AA; 320–430 px wide, no horizontal scroll.

### 12.14 Focus mode (fullscreen) — UI, added at the user's request ("no misinputs")
The game runs inside the claude.ai artifact viewer (an iframe; fullscreen may be refused, and iPhone Safari has no
element fullscreen at all), so this is two layers:
- **Focus button** (icon `focus`, in the shift HUD next to Pause, and on the title and workshop headers). Tap: try
  `document.documentElement.requestFullscreen({ navigationUI: 'hide' })` (and the webkit prefix) inside try/catch and
  promise catch; on success try `screen.orientation.lock('portrait')` (ignore failure). Tap again or exit fullscreen →
  leave. Remember the choice in localStorage (wrapped) and offer to re-enter on the next "Clock in" tap (a user gesture).
- **Focus guards, always on in a shift, whether or not fullscreen worked:** request a screen wake lock
  (`navigator.wakeLock.request('screen')`, re-request on `visibilitychange`, release on leaving the shift); block
  pinch / double-tap zoom, long-press menus, text selection and pull-to-refresh on the whole page during a shift
  (`touchmove`/`gesturestart` preventDefault with `{ passive: false }` on the stage and HUD, `touch-action: none`);
  ignore touches that start within 12 px of the left/right screen edge for steering (they're usually back-swipes);
  the Pause button needs a deliberate tap (ignore it for 400 ms after a steering drag ends, and require the touch to
  start and end on it); auto-pause when the page is hidden or fullscreen exits unexpectedly. Workshop buttons that
  spend currency ignore taps that arrive within 250 ms of a scroll in the Blueprint pane.
- Settings gets a "Focus mode" switch (on = enter fullscreen at every clock-in when allowed) and a one-line note when the
  browser refuses fullscreen ("Your browser kept its toolbars; touch guards are still on").
- Must never throw or block play when any of these APIs is missing; the shift is fully playable without fullscreen.

### 12.15 Wide tree + number rescale (user feedback, overrides 12.3, 12.6–12.8 numbers and the Blueprint layout)
**User asked:** (a) Act III should *end* where Act II ends today in damage and enemy health, so the numbers stretch
over three acts instead of exploding in Act II; (b) no 25-level nodes: split long nodes into several smaller damage
nodes spread around the tree; (c) the tree should expand outward from Sprocket in all directions, not run down a
column, so the player sees many choices.

**(a) Rescale.** Sectors 1–5 unchanged. Sector hp× from sector 5 (110) to sector 15 ≈ today's sector 10 (4e8): roughly
geometric, ≈ ×4.5 per sector (sector 10 ≈ 2e5). Bolts× likewise end at sector 15 ≈ today's sector 10 (3e6). Wardens
keep roughly their current ratio to their sector's hp (so the Chairman ≈ 1.5e8, the Founder ≈ today's Chairman 3.1e11).
Sprocket's damage at the Founder ≈ today's damage at the Chairman (Balance measures and matches). Sector dmg× for
6–15 also stretches (today's sector-10 value 24 reached at 15). Overtime keeps ×8 hp per level (endless numbers may grow).
Act II pacing (§11.14) and Act III pacing (§12.13) both still apply. Act I numbers and pacing frozen.

**(b) Split nodes.** No node above 8 levels. Act I: coil 25 → `coil` (8), `coil2` (8), `coil3` (9 — the one exception,
or 8 + fold 1 into amp; your call); cell 20 → `cell`, `cell2`, `cell3`; sorter 15 → `sorter`, `sorter2`; pulse 12 →
`pulse`, `pulse2`; field 10 → `field`, `field2`. **Act I splits are exact:** the effect per level is unchanged and the n-th
level of the chain costs exactly what level n of the old node cost, so Act I balance is preserved; `coil2` requires
`coil` maxed, etc. Derived stats sum the chain (`coilLv = coil + coil2 + coil3`). Old saves migrate (old `coil: 19` →
`coil 8, coil2 8, coil3 3`). Act II/III: replace the few huge multipliers (Fusion ×3/level ×10, Megacoil ×3 ×8, ×10
capstone forms) with more, smaller damage nodes in different parts of the tree (e.g. Fusion Coil I–III, Megacoil I–II,
plus 2–4 new modest damage nodes such as "Overdrive", "Arc Focus", "Hardened Coils"), so damage is found everywhere.
Capstone forms keep a visible but smaller jump (×3–×4). Split nodes share an icon: `def.icon` (UI draws a roman-numeral
badge from `def.tier`).

**(c) Radial tree.** Every upgrade gets `pos: [x, y]` in grid units, Sprocket (`boot`) at [0, 0], 1 unit ≈ 84 px at 1×
zoom, y down. Act I fills radius ≈ 1–4, Act II ≈ 4.5–7, Act III ≈ 7.5–10, uncapped nodes at the outer edge of their act.
Act I branches leave Sprocket on four spokes (arc north, salvage east, drones south, chassis west) and **fork**: every
chain throws side nodes off it so each branch shows 2–4 open choices at once. Capstones sit where their requirements
converge, on the boundary between acts. Act II grows outward from Titan Frame **and** from the tips of all four Act I
branches (requirements may change to an Act I tip node; gate `act2` stays); Act III likewise from Hostile Takeover and the
Act II tips (gate `chairman`). Rules: min node spacing 1.0 unit, no edge crosses a node, edges straight or one bend,
requirements only between neighbours. `upgradeInfo` gains `pos`, `tier`, `icon`, and `revealed` (owned, or any
requirement owned, or it has no requirements); unrevealed nodes are hidden in the UI (classified act nodes next to a
revealed one show as redacted plates). Layout is data; the UI must work for any positions.

**Blueprint UI for (c):** a pannable, pinch- and button-zoomable map (0.6×–1.6×, transforms only) centred on Sprocket;
faint concentric act rings labelled "ACT I · THE YARD", "ACT II · R&D", "ACT III · EXECUTIVE SUITE" with progress; the
I / II / III jump bar pans to each ring's frontier; a recentre button; newly revealed nodes pop in with a short
scale/fade (reduced motion: no animation); unrevealed space beyond the frontier shows a few faint ghost plates and
traces fading out (the "more to find" feeling). Detail sheet, plates, traces, Max button etc. as 12.12. Pan must not
trigger a purchase (tap = touch moved < 8 px). Keyboard: arrow keys pan, +/- zoom.

### 12.13 Pacing targets (Balance, wave 3)
From the first Chairman kill, attentive bot: sector 11 cleared by ~+10 min, 12 by ~+22, 13 by ~+34, 14 by ~+46, the
Founder at +58–70 min; 55–90 Act III shifts; each Act III Warden 2–4 attempts (Founder 3–5); never more than 3 shifts in
a row with nothing capped affordable; ≤ 30 spare cores at the Founder. Fresh save to Founder ≈ 3 h attentive. Overtime
levels 1–5 take 2–5 shifts each once caught up. Act I / Act II numbers unchanged.

### 12.16 Act II/III rebalance (Balance, after the 12.15 rescale)
The 12.15 first pass made Act II end at +17 min and Act III at +13 min (Founder dps ~5e13, 1000x too high). Shipped (round 2):
- **Power**: Fusion x1.36/lvl (was 1.6), Overdrive 1.19, Arc Focus 1.16, Hardened 1.1, Overtime Pay 1.23 (growth 1.6), Megacoil 1.22, Diligence 1.25, Fleet drone dmg 1.4, Dividends 1.44, Hazard Pay 1.27. Takeover x4, Stake x3 unchanged. Dmg/s: ~3.5e6 at the Chairman, ~4-5e10 at the Founder.
- **Costs**: R&D growth x1.15; Overdrive..Parachute bases x1.6; Takeover 1.2e9. Executive bases x7.8, then the single-level-ish mechanic nodes (Orbital, Expense, Insider, Legal, Diligence) halved with steeper growth, so something is always nearly affordable (the old save-up for a 3e11 node while the bot core-farmed Sector 6 was the whole dry streak). Dry streak now avg 1.3, max 4 (Act III); Act II max 2.
- **Wardens**: Forklift 1.5e5, Firewall 2.5e5, Inspector 5e6, VP 3e7, Chairman 1.5e8; Receptionist 8e8, Counsel 3.2e9, Comptroller 5e9, Market 2.5e10, Founder 2.4e12 (spec said 3e11; hp alone only moved attempts slowly, so also: Founder attack dmg x2.2, phases 3-5 cadence 0.85/0.7/0.5, Sector 15/16 dmg 34). Warden bolt payouts cut ~25x (repeat-farming sector 9 was the main income).
- **Cores**: Takeover 30, Stake 30; first-clear 5/6/7/8 and 4/5/6/7; repeat 1/1/1/3/3 and 2/2/4/4/3; Compound/Insider L5 cost 4 cores; Megacoil II/Hardened/Diligence/Fleet dearer. Spare at the Founder avg 13 (max 23).
- **Shift length**: new TUNE.overtimeStart3 95 / overtimeDrain3 0.8 read by the engine for sectors 11+ only (Act I/II keep 120 / 0.5). Act III p90 ~126 s, max ~133 s.
- **Overtime**: hp x6 per level (was 8) -> levels 1-5 take 2, 1.5, 4, 1.5, 4 shifts.
- **actReq** (~85% of the attentive bot's levels at purchase): Titan 90, Takeover 38, Stake 39.
- Attentive timeline: sectors 6-10 at +8/+30/+39/+50 and Chairman +73 (52 shifts); 11-15 at +12/+21/+37/+47 and Founder +60 (44 shifts); fresh to Founder ~3 h 16 min. Founder 3.1 attempts.

**Addendum (round 3, human capstone rule).** The reviewer showed the bot bought Titan/Takeover/Stake through `legacyReq` (a broad set), which a human never needs. tools/autopilot.js now reads only `requires` (+ the engine's `actReq` and gate); the `legacyReq` data stays in data.js but nothing reads it. tools/simbot.js also prints a `CAPSTONE` line (mean shift/time at each capstone) on exit. Under the human rule the old numbers moved: Act I unchanged (Titan at 119 levels, 62m52 / 93.4 shifts), Takeover +11 shifts, Stake +18, Act III 48.9 shifts (target 55-90), Receptionist 6.0 tries, S9 Warden 3.9-5.1, S7 arc 30m (longest outside S10), Act II dry streak max 6-9 (S6 core farming). Act I is frozen; tools/baseline-act1.txt was regenerated with the new bot only (data identical, the numbers changed only because the bot did). Act II/III changes (old -> new, why), all measured with `--runs 8 --act3`, same seeds:
- TUNE fatiguePer 0.06 -> 0.10, fatigueMax 0.36 -> 0.5: Board fatigue is the catch-up rule; the long tails (5-8 tries on S7, S11, S12) now shrink after a few misses without touching the first attempt.
- Firewall (S7) `pylonFrac` 0.12 (new): its 4 firenode pylons had the sector's firenode hp (60 x 2300 = 1.4e5 each, 8 pylons = ~4x the Warden's own 2.5e5 hp), so the shield phases were the whole wall (6-9 tries, 30m arc). Now ~3e4 each. S7 hp 2300 -> 1800 and need 220 -> 110: the sector was a bolt/dps cliff (4.6x S6); S7 arc 30m -> 17m, now in line with S8 (19m) and below S10 (23m). Firewall tries 6.0 -> 4.8.
- Receptionist (S11) hp 8e8 -> 2.5e8: hold frequency/stun was tested (every 4 -> 5.5, stun 0.8 -> 0.6) and made no difference, because the fight is a hp-vs-dps race with the first two tries leaving 75-80% hp. Tries 6.0 -> 4.0.
- Counsel (S12) hp 3.2e9 -> 1.4e9, Comptroller (S13) hp 5e9 -> 4.2e9: the same race after the shift shortening below. Tries 3.6/2.9 -> 4.0/3.4 (they were lower only because of the old long shifts).
- Founder hp stays 2.4e12 (a 2.1e12 trial changed nothing: the Founder is gated by Majority Stake, not by dps). Founder 3.4 -> 3.6 tries.
- TUNE overtimeStart3 95 -> 64, overtimeDrain3 0.8 -> 1.5: Act III shifts 48.9 -> 57 (target >= 55) at +7% Act III time (59m -> 63m). Fight windows get shorter, hence the hp cuts above.
- Sector 11-15 `need` x0.8 (300/320/340/360/380 -> 240/256/272/288/304): the Warden shows up earlier in a shorter shift, so the fight window is kept. Without it S11-S13 tries went up 2-3 with the shorter shifts.
- Cores: S6 repeat 1 -> 2 (Act II dry spell: the bot core-farmed the 20 s Forklift shift 14 times for Hostile Takeover; now max 1); S11 4/2 -> 8/3, S12 5/2 -> 6/3, S13 6/4 -> 8/5, S14 7/4 -> 10/5 (first/repeat): the Executive nodes were core-starved right after each Warden (cores 0-1 with 1e11 in the bank), which made 8-13 shift dry streaks. Spare cores at the Founder 4 (max 10).
- Stake `actReq` 39 and every node cap are unchanged: the bot buys Stake at 39.9 of 50 purchasable Act III levels (80%), ends the game with ~1 level unbought, and Stake lands 4 min before the Founder, so it is not binding. The wait for 39 levels + 30 cores sits between the Market (+51m) and the Founder (+63m), which is the intended gate.
- Result (attentive, 8 seeds): Act I 62m52 / 93.4 shifts; Act II (to Chairman) 75m44 / 55 shifts; Act III 63m22 / 57 shifts; fresh to Founder 3 h 22; tries S6-S15 4.3 / 4.8 / 3.3 / 3.4 / 2.5 / 4.0 / 4.0 / 3.4 / 1.5 / 3.6; longest nothing-affordable streak avg 1.0, max 5 (one seed; Act II max 1). Residual dry shifts are the bot's 16 s S6 core trips while waiting for the Stake cores.
- **v6 (12 Nov), user direction "earlier Wardens get less HP, later ones rely on fatigue":** Counsel (S12) hp 1.4e9 -> 2.0e9, Comptroller (S13) hp 4.2e9 -> 4.6e9; Receptionist and S7 cuts kept. Trials (same seeds): Counsel 3.2e9 + Comptroller 5e9 gave Counsel 6.3 tries and a dry streak of 11; Counsel 1.8-2.2e9 with Comptroller 5e9 left a 9-shift dry streak just before Stake (the bot had bought everything else while grinding the Comptroller); Stake `actReq` 36 did not help. Chosen: Counsel 5.0 tries, Comptroller 3.9; dry streak avg 0.9, max 5 (same as v5); Act III 53 shifts / +62 min; Act I identical.

## 10. Final report format (every agent)
End with: files written/changed; how you tested it and the actual results (numbers, not "works"); deviations
from this spec and why; bugs or contract gaps you found in other people's files; anything left undone.
