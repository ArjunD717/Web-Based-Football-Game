<!-- README.md -->
# Web Football

Private, LAN-only browser football game. The host machine owns the simulation;
both devices are thin clients. This repository is at **Milestone 12**:
server-authoritative matches, a live two-player team editor, the referee laws,
the data pipeline, a layered attribute-driven AI, selectable club and national
teams, a complete match-management layer with substitutions, injuries, added
time, extra time, shootouts, VAR-lite and full-time statistics, an animated
Three.js match presentation, local goal replays and procedural audio. M12 is
the release pass: one-command packaging, full-match balance validation,
server/client performance profiling, bug fixes and final documentation.

## Requirements

- Node.js **20.19+** (CI runs Node 20; local development tested on Node 24)
- pnpm **10.18.3** (`packageManager` pins it)
- `mkcert` for a locally trusted HTTPS certificate
- Both devices on the same LAN, with the mkcert root CA trusted on the guest

Enable pnpm if needed:

```bash
corepack enable
corepack prepare pnpm@10.18.3 --activate
```

If corepack cannot write its shims (common on Windows without admin rights), use
`npm install -g pnpm@10.18.3`.

## Host and join

```bash
pnpm install
pnpm start
```

`pnpm start` builds the client, creates the mkcert certificate when missing,
builds the sample dataset when missing, then serves HTTPS/WSS. The first run may
prompt to trust the mkcert local CA. Use `pnpm certs` whenever the LAN IP
changes or the certificate needs refreshing; use `pnpm start --skip-build` for a
fast restart of an already-built client.

The server prints its local/LAN HTTPS URLs and a lobby QR. On the host:

1. Open the printed HTTPS URL.
2. **Create room**.
3. The terminal prints a room join URL and a scannable QR. Share either.
4. On the second device, scan the room QR (or open the URL/enter the 4-letter
   code). Both devices can pick distinct clubs, arrange the XI, bench,
   reserves, tactics and takers in the live editor.
5. Press **Ready** on both devices.
6. For touch play, open the printed **phone controller** URL (also shown in the
   room panel) instead of the lobby URL. The controller page occupies the second
   seat: move with the virtual stick and use Pass / Through / Lob / Shoot /
   Tackle / Switch / Sprint / Finesse buttons.

The match starts automatically when both players are ready. Host takes the home
side, guest takes away; the selected starting XI and formation are the ones the
server simulates.

`pnpm certs` installs/refreshes the mkcert local CA and writes
`certs/dev-cert.pem` + `certs/dev-key.pem` for `localhost`, `127.0.0.1`, `::1`
and every current LAN IPv4 address. If CA installation needs elevation, run
`mkcert -install` once in an elevated terminal, then
`pnpm certs -- --no-ca-install`.

Guest devices must trust the same mkcert root CA. On Windows, import the root CA
(`mkcert -CAROOT`) into the guest's trusted root store; on Android/iOS install it
as a trusted CA profile.

## Development

```bash
pnpm certs
pnpm dev
```

`pnpm certs` writes the Vite HTTPS certificate. If it is already present,
`pnpm dev` can be run directly.

- Lobby/match via Vite: **https://localhost:5173/**
- The match opens in the 3D renderer by default; append `?renderer=2d` to force
  the canvas renderer or `?renderer=3d` to force Three.js. The choice is also
  available from the match top bar and persists in `localStorage`. Without a
  WebGL context the client falls back to canvas and explains why
- Phone controller: **https://localhost:5173/controller.html**
- M1 local practice: **https://localhost:5173/practice.html**
- M0 transport check: **https://localhost:5173/link.html**
- Node HTTPS/WSS host: **https://localhost:8443/**

The Vite proxy forwards `/ws` and `/data` to the Node host. When playing across two devices
in dev, use the 5173 URL shown in the room UI; the terminal's room QR points at
the packaged 8443 origin.

Match-only local preview (no certificates, no WebSocket):

```bash
pnpm build
pnpm preview
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Server + Vite with HTTPS/WSS proxy |
| `pnpm build` | Build lobby, match, controller, practice and link pages |
| `pnpm preview` | Preview built lobby over local HTTP |
| `pnpm start` | Build/cert-check, then serve packaged pages + WSS over HTTPS |
| `pnpm start:server` | Serve the existing build without the launcher checks |
| `pnpm certs` | Generate mkcert certificate for localhost + LAN |
| `pnpm data:build` | Ingest sample CSV, mutate names, generate JSON/assets |
| `pnpm data:validate` | Validate generated JSON + cross-file references |
| `pnpm data:preview` | Map the sample XI into sim ratings and print it |
| `pnpm lint` | ESLint flat config, type-aware |
| `pnpm typecheck` | Root + every workspace package |
| `pnpm test` | Vitest unit/integration tests |
| `pnpm test:soak` | 1,000 headless AI-vs-AI matches; fails if averages miss targets |
| `pnpm perf` | 100-match deterministic simulation throughput benchmark |
| `pnpm check` | Lint + typecheck + tests |

Useful environment overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FB_HOST` | `0.0.0.0` | Server bind address |
| `FB_PORT` | `8443` | HTTPS/WSS port |
| `FB_CLIENT_PORT` | `5173` | Vite dev port |
| `FB_CERT_DIR` | `certs` | Certificate directory |
| `FB_STATIC_DIR` | `packages/client/dist` | Built client directory |
| `FB_DATA_DIR` | `data` | Generated public football data |
| `MKCERT_BIN` | `mkcert` | mkcert executable |
| `FB_SKIP_BUILD` | unset | Set `1` to skip the launcher's client build |
| `FB_SKIP_CERTS` | unset | Set `1` to fail instead of creating missing certificates |
| `FB_AUTO_CERTS` | unset | Set `0` to fail instead of creating missing certificates |

## Milestone 12 scope

Implemented:

- `pnpm start` is the release one-liner. It builds the client, creates mkcert
  material when absent, builds sample data when absent, then starts the HTTPS/WSS
  host. `pnpm start:server` remains available for an existing build
- The server loop now runs at the simulation rate (60 Hz) instead of waking at
  250 Hz; the fixed-step accumulator absorbs ordinary timer jitter. `/healthz`
  reports rolling tick count, budget, p95, max and over-budget count
- A deterministic 100-match benchmark (`pnpm perf`) reports simulation steps per
  second, real-time factor, average step cost and heap delta. On the development
  machine (Node 24, Windows): **89,984 ticks/s**, **0.011 ms/step** and
  **25.0 simulated minutes per second**; the server measured **0.72 ms p95**
  and **3.08 ms max** during a live packaged 3D match, with zero over-budget
  ticks at the 16.67 ms budget. A two-second headless Chromium sample at
  1280x900 rendered the 3D match at 78.6 fps (p95 18.2 ms/frame); real GPU
  hardware will differ
- Full-match soak accounting now includes both halves, half-time, added time
  and the safety margin; the old cap could stop a run while still live. Every
  match must reach `fullTime`
- A period normally still ends at the next natural pause after the added-time
  board. If play never pauses, a 120-game-second safety whistle ends the period
  instead of allowing an unbounded clock
- Pass statistics now count attempts and completions from the first teammate
  touch or kick; previously the stats screen always showed `0/0`
- The release bug-bash fixed Windows launcher spawning (`EINVAL` on `pnpm.cmd`),
  custom `FB_CERT_DIR` handling during auto-generation, and the soak cap that
  hid matches running beyond full time
- Tests now cover pass completion/incompletion/restart clearing, full-match
  termination, the safety whistle, server tick metrics and health reporting

Balance baseline over **1,000 deterministic full matches** (`pnpm test:soak`):

| Metric | Result | Target |
| --- | ---: | ---: |
| Goals per match | 2.588 | 2.5–3.0 |
| Shots per team | 8.56 | 8–14 |
| Fouls per team | 11.93 | 10–12 |
| Offsides per team | 2.37 | 2–4 |
| Yellow cards per match | 1.85 | 1.5–2.0 |

All 1,000 matches reached `fullTime`; the run took 556 s and reported zero
target misses.

Known M12 limitations (by design):

- Balance targets are validated with the default professional AI in AI-vs-AI
  matches; human matches and other difficulty profiles can differ
- The safety whistle is a liveness guard, not a law variant: in the pathological
  case where no natural pause arrives, it can cut a live attack two game minutes
  after the board
- Pass completion is a first-touch proxy. Deflections, rebounds and intended
  receiver identity are not modelled, so completion percentages are lower than
  a commercial stats feed
- Performance numbers are from one development machine; there is no CI
  performance gate, and low-end GPUs may prefer `?renderer=2d`
- `pnpm start` still requires Node, pnpm and mkcert plus guest CA trust; it is
  not a standalone binary or container
- The Three.js client bundle is still loaded with the lobby and exceeds Vite's
  500 kB chunk warning threshold (about 157 kB gzip)

## Milestone 11 scope

Implemented:

- The match presentation is now behind the existing `MatchRenderer` interface.
  A Three.js renderer draws a lit, striped 105 x 68 m pitch with goal frames,
  netting, a ball shadow, a surround plane and a fitted perspective camera. The
  camera projects the pitch corners every time the stage aspect or pitch changes
  and adjusts its distance until the whole playing area fits
- Players are low-poly capsule rigs with team kits, shorts, socks, skin/hair
  variation, shirt numbers and a card marker. Local-space animation poses drive
  sprint lean, kick/header/volley, tackle/slide/fall, dribble and celebration
  states; facing comes from the authoritative snapshot
- The canvas 2D renderer remains the practice renderer and the automatic
  fallback. WebGL failures are caught, reported as a toast and keep the match
  playable. Renderer mode survives reloads and can be overridden with
  `?renderer=2d` / `?renderer=3d`
- The client keeps a bounded 12-second ring of rendered match views. When the
  scoreline changes it freezes the preceding 5.5 seconds; the **Replay goal**
  button (or `R`) plays this locally in a slow-motion 3D replay with a progress
  banner and a stop button. The live server simulation keeps running
- Procedural Web Audio supplies kick/whistle/goal sounds and a quiet crowd bed
  with no bundled audio assets. The **Sound on/off** control persists its
  preference and the context unlocks on the first pointer/key gesture
- Unit tests cover renderer pose mapping, the exact-fit camera projection,
  pitch layout/asset-free mesh construction and replay-buffer goal detection,
  trimming and playback sampling

Known M11 limitations (by design):

- Players are procedural low-poly rigs; there are no GLTF/skeletal animation
  assets, facial animation or broadcast-quality cutscenes
- The camera is a static full-pitch tactical view with a fixed angle; it does
  not follow the ball or cut between broadcast cameras
- Replays are local to the client, cover the last goal only, render through the
  3D scene even if the pitch is currently in 2D mode, and are not persisted or
  shared over the network
- Audio is synthesized; there is no commentary, music, positional audio or
  pre-match crowd recording. Browsers require the first user gesture before
  sound can start
- The Three.js bundle is loaded with the lobby client; a slow device may take
  slightly longer to become interactive than the canvas-only build

## Milestone 10 scope

Implemented:

- The draft room exposes host-only competition options: half length (4, 6, 8 or
  10 real minutes), extra time, penalty shootout and VAR-lite. Settings are
  validated, broadcast to both devices and reset both ready flags
- Matchday benches enter the simulation. Requests are queued from the in-match
  Substitutions dialog and applied at the next natural stoppage or half-time;
  the server enforces five substitutions in three windows (plus one substitution
  and one window in extra time), keeps a goalkeeper in goal, forbids replacing
  a sent-off player and broadcasts the updated roster to both clients
- The game clock scales real-half minutes to 45/90/105/120 game minutes. Stoppages
  accumulate an added-time board (goals, cards, substitutions, injuries, VAR);
  the period ends at the next natural pause after the board expires, with a
  safety whistle if play never pauses
- Extra time and a best-of-five penalty shootout (sudden death when required)
  are implemented as referee state, with deterministic taker selection,
  conversion/save checks and shootout events
- Goals, penalties and direct red cards can trigger a three-second VAR-lite
  review. An overturned review restarts play correctly or cancels the penalty;
  confirmed red cards are issued after the check
- Injuries are assessed deterministically from tackle severity and
  injury-proneness; minor knocks can be played through at reduced speed/stamina,
  serious injuries use a stretcher delay, and drop balls restart non-foul
  stoppages
- Goalkeeper possession uses the configurable eight-second hold law; a team
  below seven available players forfeits automatically
- The protocol adds host settings commands, queued substitution commands,
  roster/notice broadcasts, match statistics, VAR reviews and shootout state.
  Snapshots carry the new dead-ball, half-time, shootout and full-time phases
- The client renders added time, extra time period labels, shootout score,
  VAR review boards, the substitution dialog and a full-time statistics screen
  with possession, shots, saves, passes, fouls, offsides and cards
- Tests cover substitution windows and limits, goalkeeper replacement, injury
  risk, shootout alternation/clinching and extra-time-to-shootout transitions,
  server settings/roster/statistics flow, and protocol parsing for every new
  message

Known M10 limitations (by design):

- Substitutions are requested through the in-match dialog; the AI does not make
  tactical substitutions or automatically replace an injured AI player
- The goalkeeper eight-second hold target is tuned in `TUNING.referee`, not
  exposed as a per-room setting
- The match clock and added-time board are deterministic simulation state; there
  is no fourth-official board animation or broadcast-style stoppage summary yet
- VAR-lite freezes the simulation for a fixed three seconds and uses the
  deterministic severity margins in `TUNING.var`; there is no pitch-side monitor
  UI or animated review sequence
- Shirt numbers for substitutes come from the authored squad data; squad-number
  changes are not editable in the pre-match editor
- Competition formats (two legs, aggregate, away goals and cross-match
  suspensions) remain future work

## Milestone 9 scope

Implemented:

- `callups.csv` supplies each nation's ordered 26-man call-up squad and wider
  reserve pool. The file is optional for legacy inputs, which fall back to the
  strongest 26 players by overall; supplying it enables explicit selection and
  validation
- The normaliser rejects unknown nations/players, duplicate call-ups, wrong
  nationalities, squads that are not exactly 26 and squads with fewer than two
  goalkeepers
- `national-teams.json` contains playable national `TeamData`: 26-player squad,
  generated 4-3-3 default sheet, generated crest and home/away/third kits,
  nation colours, `kind: "nation"` and a `nationId`
- `nations.json` keeps the 26 call-ups and reserve pool separate; the reserve
  pool is available for future call-ups but is not part of the matchday sheet
- Data schema v3 adds `kind`, nullable league membership, `nationId`, national
  team and manifest arrays, and cross-file validation for call-ups and national
  squads
- The server registry indexes clubs and national teams together for room
  selection, sheet validation and match creation. National sheets skip the
  club-ownership check while still enforcing 26-player coverage, one keeper in
  the XI and a bench keeper
- The team editor adds a **Team type** filter (`Clubs`, `National teams`,
  `All teams`), national cards, generated nation crests/kits and the live
  opponent summary. Club and national team IDs are mutually exclusive within a
  room
- National starting XI shirt numbers are assigned 1-11 by slot because the
  source kit number is club-specific; this keeps the match roster unique
- The sample dataset is expanded to 156 fictional players across three clubs
  and five nations, with 26 call-ups plus a reserve pool per nation, so all
  national teams are playable without inventing a second player-supply path
- Tests cover call-up parsing/validation, 26-man squad generation, national
  assets, schema/cross-file checks, registry validation and a headless
  nation-versus-club match start

Known M9 limitations (by design):

- The wider national reserve pool is not selectable in the pre-match editor;
  the matchday squad is the 26 call-ups
- No national-team competitions, friendlies, call-up changes or eligibility
  rules yet; national teams are selected directly in the friendly room
- National shirt numbers are generated from the starting-slot order rather than
  authored per nation
- The sample data remains clearly labelled fake data; the real CSV registry is
  still supplied by the user
- National reserve players outside the 26-man call-up cannot be added to the
  matchday bench in the editor

## Milestone 8 scope

Implemented:

- The simulation now consumes the authored attributes used by movement,
  contact, passing, shooting, aerial ability, goalkeeping and role familiarity;
  detailed ratings are no longer reduced to a movement-only subset. Skill
  moves, weak foot, work rates, body type and PlayStyles remain in the data for
  later skill/animation work
- Four AI layers run inside the fixed tick: a team tactical plan (phase,
  defensive line, compactness, press triggers, support/runners/overlap), role
  templates for all 13 positions, weighted individual decisions
  (pass/dribble/shoot/clear) and steering (seek, arrive, intercept, separate,
  goal-side marking)
- Formations and authored tactics feed positioning: defensive depth, width,
  press intensity and build-up style change line height, lateral spread, second
  presser triggers and pass selection; the offside line is the second-last
  defender, never behind the ball
- Passing scores lane clearance, openness, forward progress, danger, pressure,
  offside risk and build-up style. Through balls lead the runner; a seeded
  mistimed through-ball share deliberately tests the offside law
- Shooting scores range, angle, pressure, finishing, shot power and long shots;
  clearances are only considered in the defensive third; goalkeepers distribute
  instead of taking outfield decisions
- Set-piece routines include defensive walls, near/far-post corner runners,
  free-kick runners, penalty taker/keeper/encroachment holds, throw-ins, goal
  kicks and corner delivery
- Goalkeepers claim loose balls in the area, sweep outside it when the ball is
  loose and they are closer than any opponent, narrow the angle, and hold the
  penalty line
- Five difficulty profiles (`beginner`, `amateur`, `professional`,
  `worldClass`, `legendary`) scale reaction cadence, decision noise, pass and
  shot error, pressing aggression, tackle bias and through-ball intent
- Every match accumulates deterministic stats (goals, shots, shots on target,
  fouls, offsides, cards, saves, possession); no `Date.now()` or `Math.random()`
  entered the sim
- `pnpm test:soak` runs 1,000 headless AI-vs-AI matches and fails when the
  deterministic averages leave the brief's bands: 2.5-3.0 goals, 8-14 shots per
  team, 10-12 fouls per team, 2-4 offsides per team and 1.5-2.0 yellows
- Unit tests cover role/difficulty profiles, reaction gating, attack/defence/
  loose-ball plans, tactic influence, set-piece holds and runner targets,
  goalkeeper sweeping, deterministic on-ball actions and stat accounting

Known M8 limitations (by design):

- There is no separate cross/driven-pass decision yet; long passes already use
  lift, curve and long-passing accuracy, but dedicated crossing routines are
  future work
- Skill moves, weak-foot selection, work rates, PlayStyles and body-type
  hitboxes are retained in the data but do not yet drive AI tendencies or
  animation
- The five difficulty profiles are accepted by the match API but are not yet
  exposed as a lobby selector
- Set-piece routines are positional AI, not authored plays; the user cannot yet
  resize the defensive wall in-match
- AI-controlled sides do not make tactical substitutions or injury
  replacements automatically; user-controlled sides use the matchday bench
- AI is server-authoritative and runs without local prediction; client
  reconciliation remains a later feature flag
- Offside active involvement is modelled with a 2.1 m ball proximity plus a
  challenge radius; the visual assistant-referee presentation comes later

## Milestone 7 scope

Implemented:

- Shared formation geometry for all 16 documented shapes (`4-4-2`, five
  `4-3-3` variants, `4-2-3-1`, `4-1-4-1`, `3-5-2`, `3-4-3`, `5-3-2`, `5-2-3`,
  `4-4-1-1`, `4-3-2-1`, `4-1-2-1-2`, `3-4-1-2`); the data pipeline, editor and
  simulation consume one canonical slot order
- Shared deterministic sheet builder/parser/validator: best-XI auto-pick,
  formation/role checks, exactly one starting goalkeeper, backup keeper on the
  bench, all squad players accounted for, unique players, and takers in the XI
- Server loads and validates generated data on startup (failing with a clear
  `pnpm data:build` message), serves only whitelisted public JSON/SVG under
  `/data`, and never exposes `data/input` or `data/reports`
- Draft room owns each seat's club and full team sheet. `setTeam` and
  `updateSheet` are validated against the selected squad; invalid or conflicting
  changes are rejected with structured errors
- Every accepted edit is broadcast to both devices, so club, formation, XI,
  bench size, tactics and takers stay live-synced. Players can pick only a club
  the opponent has not chosen
- Editor UI: responsive pitch with role-labelled cards, tap-to-swap and
  drag-and-drop, bench 5-9, reserves, auto-pick, reset, local save/load,
  JSON import/export, searchable and position-filterable reserves, full player
  cards (headshot, nation, face stats, all detailed/GK attributes, PlayStyles, weak foot,
  skill moves, work rates, height/weight/body type) and opponent live summary
- Club picker filters by league and shows the generated crest, home/away/third
  kit artwork, club colours, stadium and manager; player cards show generated
  headshots and nationality names
- Home/away/third kit selection is stored in the sheet, previewed in the
  editor, and becomes the primary kit colour in match setup and the renderer
- Role-fit badges mark natural, accomplished and out-of-position outfielders;
  the editor explains the one-keeper, bench-size and full-squad rules, while
  the server enforces them. Exactly one goalkeeper and a bench keeper remain
  hard requirements
- Tactics include defensive depth, width, press intensity and build-up style;
  captain, penalty, free-kick and corner takers are selectable from the XI
- Match creation consumes the server-approved sheet: the selected XI, kit
  numbers, club colours, names and shape feed the deterministic simulation and
  the wire roster. Room tests prove an edited `4-4-2` XI reaches match setup
- Protocol v6 adds `setTeam`, `updateSheet`, and team/sheet fields in lobby
  state; the client catalog fetches the generated data through the same origin
- Data schema v2 adds the match-kit choice to every sheet; `pnpm data:build`
  rewrites the manifest and defaults
- Tests cover all shared formation mappings, protocol parsing, team assignment,
  live sheet sync, invalid/conflicting edits, and match setup from an edited
  sheet including the selected kit colour

Known M7 limitations (by design):

- The draft validates the bench and reserves; M10 adds in-match substitutions,
  injuries, send-off replacements, added time, extra time, shootouts and VAR
- Tactics and set-piece taker choices are stored and synced authoritatively;
  their AI/gameplay influence is implemented in the M8 tactical brain
- Formation shapes are fixed by the chosen preset; free-form slot dragging and
  custom formations are not part of M7
- Local prediction, match history and persistent career saves still wait for
  later milestones

## Milestone 6 scope

Implemented:

- `packages/data-tools`: strict CSV ingestion, normalisation, cross-file
  validation, generated JSON, deterministic name mutation and an audit report
- `pnpm data:build` writes `data/leagues.json`, `teams.json`,
  `national-teams.json`, `players.json`, `nations.json`, `manifest.json`,
  placeholder SVG crests/kits/faces and `reports/name-mutations.csv`
- Zod schemas reject unknown fields, out-of-range ratings, duplicate squad
  players, malformed sheets and inconsistent cross-file references; `realRef`
  cannot leak into generated JSON
- One **fake** sample league: three fictional clubs, five fictional nations and
  156 fictional players (expanded in M9 so every nation can field the required
  26 call-ups), clearly marked in every generated record and in
  `data/input/sample/README.md`
- Deterministic, ID-seeded name mutation using phonetic confusion, vowel
  shifts, consonant-cluster tweaks and a small curated pun list; it preserves
  the first name where possible, rejects source names/offensive candidates,
  enforces pronounceability and global uniqueness, preserves diacritics,
  supports `name_overrides.csv`, and logs every mutation
- All-documented-formation role tables auto-build a starting XI, seven-player
  bench with a backup keeper, reserves, captain and penalty/free-kick/corner
  takers; the sample clubs use 4-3-3
- Full imported attributes are retained in JSON; `mapPlayerAttributes` blends
  related attributes into the compact simulation ratings, and
  `createTeamFromData` creates a playable XI from a generated sheet
- Optional `--rename-clubs` generates deterministic substitute club names and
  regenerates their crests

### Input CSV schema

All CSV columns below are required unless marked optional. Pipe-separated lists
use `|`. IDs are lowercase kebab-case. `real_ref` is build-time only and is
never written to generated JSON.

**`players.csv`**

| Group | Columns |
| --- | --- |
| Identity | `player_id`, `real_name`, `real_ref`, `age`, `dob`, `nation_id`, `club_id`, `positions`, `preferred_position`, `overall`, `potential` |
| Profile | `foot`, `height_cm`, `weight_kg`, `body_type`, `skill_moves`, `weak_foot`, `injury_proneness`, `kit_number`, `work_rate_att`, `work_rate_def`, `play_styles` |
| Face ratings (may be empty) | `face_pac`, `face_sho`, `face_pas`, `face_dri`, `face_def`, `face_phy` |
| Outfield attributes | `acceleration`, `sprint_speed`, `finishing`, `shot_power`, `long_shots`, `volleys`, `penalties`, `att_position`, `short_passing`, `vision`, `crossing`, `long_passing`, `fk_accuracy`, `curve`, `dribbling`, `agility`, `balance`, `reactions`, `ball_control`, `composure`, `interceptions`, `heading_accuracy`, `def_awareness`, `standing_tackle`, `sliding_tackle`, `jumping`, `stamina`, `strength`, `aggression` |
| Goalkeeper attributes | `gk_diving`, `gk_handling`, `gk_kicking`, `gk_positioning`, `gk_reflexes`, `gk_speed` |

Goalkeeper columns are required for players who list `GK` and must be empty for
everyone else. `real_ref` may be empty. Face-rating cells may be empty; missing
ratings are derived from the detailed attributes, while provided ratings are
copied unchanged. Detailed stats are never rescaled.

**`clubs.csv`**: `club_id`, `name`, `short`, `league_id`, `primary_color`,
`secondary_color`, `third_color`, `goalkeeper_color`, `stadium`,
`manager_name`, `formation`.

**`leagues.csv`**: `league_id`, `country`, `name`, `tier`, `season`. Tier must
be `1`; club IDs are derived from the clubs' `league_id`.

**`nations.csv`**: `nation_id`, `name`, `short`, `primary_color`,
`secondary_color`, `third_color`, `goalkeeper_color`.

**`callups.csv`** (optional, required for an explicit national registry):
`nation_id`, `player_id`, `group`. `group` is `squad` or `reserve`; row order is
preserved. Every nation needs exactly 26 `squad` rows, at least two
goalkeepers, unique players and matching `nation_id` values. Missing files fall
back to the strongest 26 players by overall.

**`name_overrides.csv`**: `player_id`, `override_name` (optional file, required
header when present).

**`dataset.json`**: `{ "sample": boolean, "label": string, "description"?: string }`.
When `sample` is true, every generated league, team, player and nation is
marked `sample: true`.

Build options:

```bash
pnpm data:build -- --input data/input/sample --out data --reference-date 2026-07-01
pnpm data:build -- --no-assets --rename-clubs
pnpm data:validate -- --data data
```

M7 note: the data builder, editor and simulation now consume the same geometry
for every documented formation name; the M6 pipeline already generated all of
them. The full attribute-to-sim map covers the
movement/contact ratings used today; passing/shooting/AI consumption was
completed in M8.

## Milestone 5 scope

Implemented:

- Referee state machine with `deadBall`, `live`, `halfTime` and `fullTime`;
  seeded, deterministic 60 Hz simulation clock scaled from the selected real
  half length, half-time interval, ends swap and full-time freeze
- Goal-line law: whole ball over the line, between the posts and under the bar;
  own goals and direct goals from open play, kick-offs, goal kicks and corners;
  direct goals from a throw-in or indirect free kick are disallowed until
  another player touches
- Out-of-play law: whole-ball touchline exits become throw-ins to the side that
  did not touch last; goal-line exits become corners or goal kicks from the
  last-touch record
- Restart placement: kick-off own halves and centre-circle clearance, throw-in
  taker/2 m opponent clearance, goal-kick placement with opponents outside the
  penalty area, and corners with 9.15 m defender clearance
- Tackle contact events with a tunable severity model (approach angle, relative
  speed, ball-won-first, tackle/balance/aggression ratings, sliding contact),
  strictness offsets (`lenient` / `standard` / `strict`), careless/reckless/
  excessive-force fouls, yellow/red cards, second yellow = red, DOGSO reds and
  send-offs that remove the player from control, AI selection and rendering
- Advantage: a direct-free-kick foul is held for three seconds and converted to
  the free kick if the attacking side fails to gain the configured progress
- Handball law for deliberate contact, an unnaturally bigger arm/body and an
  arm above the shoulder, including goalkeeper handling rights, penalty awards
  and attacker handball before a goal
- Offside: positions snapshotted at the decisive kick, second-last-defender and
  ball lines, opponent-half requirement, active involvement by touching or
  challenging, and throw-in/goal-kick/corner exemptions
- Direct and indirect free kicks with a 9.15 m AI-managed defensive wall
  (2–6 players), taker placement and opponent clearance; free kicks inside
  shooting range only
- Penalty kicks: spot placement, goalkeeper on the line, all other players
  outside the area and arc, taker/GK/non-participant hold rules, double-touch
  offence, and encroachment retake or indirect-free-kick outcomes
- Referee events (foul, advantage, yellow, red, offside, handball, penalty)
  travel in snapshots; the HUD shows the latest event, card counts and the
  free-kick/penalty restart overlay
- AI defenders challenge ball carriers with a deterministic tackle decision;
  AI chasers, wall players, penalty takers and sent-off players are gated by
  the referee state
- Score, match clock, half, restart type/side and discipline travel in every
  binary snapshot; clients show a live scoreline, clock, phase, card counts and
  restart/full-time overlays
- Inputs are ignored while the referee has stopped play; the server still
  simulates one authoritative match and gates human control until `live`
- Server freezes the simulation and keeps the final snapshot after the second
  half reaches full time
- M2 room manager, four-letter codes, host/guest seats, ready-up, QR invites,
  30 Hz binary deltas, acks, 100 ms interpolation and session-token reconnect
- Binary input frames at 60 Hz: sequence, button bitmask, quantised stick axes
  and a local shot-charge value; the server drains the client queue each tick
- Exactly one server-selected controlled player per seat, with automatic switch
  to the nearest player to the ball (or the interceptor) and a manual switch
  button; goalkeepers participate in both paths when they are the right choice
- Human movement with attribute-driven top speed, acceleration and turn rate,
  sprinting, and controlled-player AI suppression while a human owns the player
- Ground pass, through pass and lob/cross with lead targeting; charged shot with
  server-authoritative hold timing and the finesse modifier; standing tackle
- Keyboard defaults: WASD/arrows move, Shift sprint, X pass, C through, V lob,
  Z shoot, F tackle, Space switch, E finesse; bindings are rebindable from the
  **Controls** dialog and persist in `localStorage`
- Standard-mapping gamepad: stick move, A pass, B/RT shoot, X tackle, Y through,
  LB switch, RB lob, LT sprint, L3 finesse (mapping is fixed; keyboard is
  rebindable)
- Phone controller at `/controller.html?room=CODE`: virtual stick, touch action
  buttons, live connection state, score/clock/phase/card counts, rule-event
  banner and its own power meter
- Match HUD includes the controlled-player label, white active-player ring, a
  shot power bar, scoreline/card counts, rule-event banner and restart overlays;
  input pauses automatically when the match pauses or disconnects
- Local practice and the M0 transport check remain available as separate pages

Not implemented yet (by milestone design):

- Competition structures, two-legged ties, aggregate scoring and suspensions
  carried across matches
- Referee strictness exposed in the lobby UI (the sim API accepts it)
- Skill moves, charged/driven passes, first-time pass modifiers, manual pause
  and controller vibration
- Gamepad rebinding; only the standard mapping is wired
- Real CSV registry and further national-team competition modes; M9 ships the
  call-up pipeline and playable national teams, but the bundled dataset is
  still clearly marked fake sample data
- Real animation assets (GLTF/skeletal), commentary audio, server-side replay
  clips/export, broadcast camera cuts and a career/competition mode
- Local prediction/reconciliation; controls feel the RTT on a LAN
- Authentication. The server is intended for a trusted private LAN only.

## Protocol and reconnect notes

- `PROTOCOL_VERSION = 8`. Hello accepts an optional `sessionToken`; the welcome
  returns the stable token as `sessionId`. The browser keeps it in
  `sessionStorage`.
- Lobby JSON carries each seat's selected club and full `TeamSheet`;
  `setTeam` and `updateSheet` are client commands, and `lobbyState` is
  re-broadcast to both seats after every accepted edit.
- Snapshot deltas are sent at 30 Hz. Each client acks the latest decoded
  sequence with a 5-byte binary message; the server builds the next delta from
  that ack.
- Snapshot headers are 29 bytes and include the match clock (seconds), phase,
  half, score, restart type/side and the latest rule event (seq/type/side/
  player number), so the scoreline and card feed are authoritative even when a
  delta carries no changed players.
- Input frames are binary type 17, 12 bytes: type, uint32 sequence, uint16
  buttons, two int16 stick axes and a uint8 local charge. The server accepts at
  most eight queued frames per seat per tick and drains them before the match
  step; actions only affect the seat's currently selected player.
- Shot power is measured by how long SHOOT is held on the server. The client's
  `chargePower` is display data, not authority; finesse is a separate bit.
- Player fields are quantised to centimetres and centimetres per second. Ball,
  facing, state, stamina, yellow-card count, sent-off flag and the
  controlled-player indices are included in each changed-player record.
- If a client asks for `resync`, reconnects, or acks a sequence no longer in the
  history ring, the server sends the static setup plus a full snapshot.
- The client renders 100 ms behind arrival to absorb 30 Hz spacing and LAN jitter.
  The ball is always server-driven; there is no client-side prediction yet.
- Disconnects pause the simulation; the seat is held for 60 s. Gameplay resumes
  only after both seats are connected again. There is no forfeit scoring yet.

## Milestone 1 base

The headless simulation package remains pure and deterministic: fixed 60 Hz,
seeded RNG, SI units, no DOM/Node globals, with pitch/ball/player physics,
placeholder 4-3-3 AI, state hashing, and tests. `/practice.html` runs that
simulation locally for offline inspection.

## Tests

```bash
pnpm check
```

Coverage includes shared math/RNG, protocol parsing, binary full/delta snapshots
and acks, event/card/restart round-trips, input codec and gamepad mapping,
pitch/formation/physics/ball/Magnus/collision tests, goal-line and touchline
classification, all restart placements, free-kick wall geometry, penalty
placement/encroachment, 108 scripted offside positions, 16 scripted handball
decisions, tackle severity/strictness/DOGSO, advantage expiry, offside
involvement/exemptions, handball penalties, card/send-off consequences,
referee clock/half-time/full-time transitions, deterministic headless match
soak, human pass/shot/tackle, room lifecycle, snapshot streaming and acks,
transport token resume/replacement, binary handler forwarding, client
interpolation, HTTP/TLS/static serving, and server/client reconnect
pause/resume. M6 adds CSV quoting/header errors, deterministic mutation
strategies/overrides/uniqueness/diacritics, normalisation and stat-copy checks,
sheet construction, schema/cross-file rejection, asset/report generation,
byte-deterministic rebuilds, fuzzy club renaming, and sim attribute/team mapping.
M10 adds substitution windows/limits, injury risk, shootouts, extra time, VAR,
settings/roster/statistics protocol flow and the full-time client state. M11
adds Three.js pose/camera/pitch tests and the client replay buffer. M12 adds
full-time soak accounting, the safety whistle, pass completion stats and server
tick metrics.

The two-minute data check:

```bash
pnpm data:build
pnpm data:validate
pnpm data:preview
```

Expect one league, three clubs, five national teams, 156 players, five nations,
188 generated SVG assets and 156 audit rows; every record must report the
sample marker. The preview must print a `Kingsport United` 4-3-3 XI with mapped
sim ratings. Load the lobby, switch **Team type** to National teams, select a
nation, and verify the 26-player call-up sheet and generated nation crest/kit;
all 16 formations must remain selectable and auto-pickable.

The two-minute match check:

1. `pnpm start` (it builds the client and creates missing certificates/data).
2. Open the printed LAN URL on the host; trust the certificate.
3. Host **Create room**; verify the terminal prints a room URL, a phone
   controller URL and a room QR, and the team editor loads a club by default.
   Switch **Team type** to National teams, pick a nation, and verify the squad
   editor and generated national crest/kit.
4. The guest either opens the room URL (desktop controls) or the controller URL
   (touch controls). Change the host formation and bench size; verify the guest
   opponent summary updates. Then ready both; verify both canvases show the same room and
   moving server tick, with ping in the HUD. Confirm the scoreline reads
   `0 – 0`, the clock starts at `00:00`, and the **Kick-off** overlay clears when
   play goes live.
5. Force a restart with a heavy pass or shot: verify the scoreline/clock update
   and the overlay names the restart and side. Goals update the score and return
   to a conceded-side kick-off.
6. Tackle repeatedly near the ball: verify fouls produce a free-kick or penalty
   overlay, the event banner names the card, and the persistent card counter
   matches. A red card removes that player from the pitch and from control.
7. Play through the middle until the assistant flags a runner: verify the
   offside event and indirect free kick; check a free-kick wall forms at least
   9.15 m from the ball for a foul within shooting range.
8. On the host, move with WASD and sprint; press **Controls** to rebind a key and
   confirm it survives a reload. Hold Z and verify the shot power bar rises and
   clears on release.
9. On the phone, move with the stick, fire a charged shot (power shows) and tap
   **Switch**; verify the white active-player ring moves. Tap Pass/Through/Lob/
   Tackle/Sprint/Finesse to exercise the same input path.
10. Close the guest tab: host shows **Match paused** with a reconnect countdown.
    Reopen with the same token (or reload the guest) to resume.
11. Guest **Leave**: host returns to the room lobby with the code intact.
12. `pnpm check`: expect 46 test files and 477 tests passing.
13. Verify the 3D presentation: the match opens in 3D, the whole pitch fits
    after resizing the window, players animate and carry numbers, and the
    **2D view** button switches renderers. Reload and confirm the mode persisted.
    Append `?renderer=2d` to load the canvas renderer directly.
14. Score a goal and press **Replay goal** (or `R`): verify the slow-motion
    replay banner, progress and stop control. Toggle **Sound** and confirm the
    whistle/kick/goal effects and crowd bed respect the setting. Disable WebGL
    in a test browser to verify the automatic 2D fallback toast.
15. Open `/healthz` and verify `simulation.loopHz` is 60, the tick budget is
    16.67 ms and `p95TickMs` stays below the budget during a live match.
16. Run `pnpm test:soak` (1,000 full matches) and `pnpm perf`; both must finish
    without a target miss or unfinished match.

## Layout

```text
packages/shared      math, RNG, tuning, data contracts, protocol, input/snapshot codecs
packages/sim         pure fixed-step football simulation, data mapping and human actions
packages/data-tools  CSV ingest, normalise, validate, name mutation, sheets, assets
packages/server      HTTPS/WSS, sessions, rooms, input routing, match runner, QR
packages/client      LAN lobby, match client/interpolation, canvas + Three.js renderers
  ├── controller     phone controller page (virtual stick + action buttons)
  ├── practice.html  offline M1 simulation
  └── link.html      M0 transport diagnostics
data                 generated JSON registry, placeholder assets and reports
  └── input/sample   clearly marked fake 3-club sample CSV
scripts              one-command start and mkcert setup
certs                generated locally; ignored by git
```
