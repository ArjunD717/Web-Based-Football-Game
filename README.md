<!-- README.md -->
# Web Football

Private, LAN-only browser football game. The host machine owns the simulation;
both devices are thin clients. This repository is at **Milestone 5**:
server-authoritative matches with the referee-owned clock, score, half-time ends
swap, goal/out-of-play restarts, fouls and cards, advantage, offside, free kicks
with a wall, penalties and handball — layered on the M3 input, binary snapshot,
interpolation, latency HUD and token reconnect stack.

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
pnpm certs
pnpm build
pnpm start
```

The server prints its local/LAN HTTPS URLs and a lobby QR. On the host:

1. Open the printed HTTPS URL.
2. **Create room**.
3. The terminal prints a room join URL and a scannable QR. Share either.
4. On the second device, scan the room QR (or open the URL/enter the 4-letter
   code), then press **Ready** on both devices.
5. For touch play, open the printed **phone controller** URL (also shown in the
   room panel) instead of the lobby URL. The controller page occupies the second
   seat: move with the virtual stick and use Pass / Through / Lob / Shoot /
   Tackle / Switch / Sprint / Finesse buttons.

The match starts automatically when both players are ready. Host takes the home
side, guest takes away.

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
pnpm dev
```

- Lobby/match via Vite: **https://localhost:5173/**
- Phone controller: **https://localhost:5173/controller.html**
- M1 local practice: **https://localhost:5173/practice.html**
- M0 transport check: **https://localhost:5173/link.html**
- Node HTTPS/WSS host: **https://localhost:8443/**

The Vite proxy forwards `/ws` to the Node host. When playing across two devices
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
| `pnpm start` | Serve built pages + WSS from Node over HTTPS |
| `pnpm certs` | Generate mkcert certificate for localhost + LAN |
| `pnpm lint` | ESLint flat config, type-aware |
| `pnpm typecheck` | Root + every workspace package |
| `pnpm test` | Vitest unit/integration tests |
| `pnpm check` | Lint + typecheck + tests |

Useful environment overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FB_HOST` | `0.0.0.0` | Server bind address |
| `FB_PORT` | `8443` | HTTPS/WSS port |
| `FB_CLIENT_PORT` | `5173` | Vite dev port |
| `FB_CERT_DIR` | `certs` | Certificate directory |
| `FB_STATIC_DIR` | `packages/client/dist` | Built client directory |
| `MKCERT_BIN` | `mkcert` | mkcert executable |

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

- Substitutions, added time, the "next natural pause" half-end law, injuries,
  extra time and penalty shootouts (M6/M10)
- VAR-lite, competitions, suspensions carried across matches and referee
  strictness exposed in the lobby UI (the sim API accepts it)
- Skill moves, charged/driven passes, first-time pass modifiers, manual pause
  and controller vibration
- Gamepad rebinding; only the standard mapping is wired
- Real data pipeline, club/nation selection, team editor, tactics (M6/M7/M9)
- M8 AI layers, difficulty, set-piece routines beyond the defensive wall
- Three.js, animation, replays, audio (M11)
- Local prediction/reconciliation; controls feel the RTT on a LAN
- Authentication. The server is intended for a trusted private LAN only.

## Protocol and reconnect notes

- `PROTOCOL_VERSION = 5`. Hello accepts an optional `sessionToken`; the welcome
  returns the stable token as `sessionId`. The browser keeps it in
  `sessionStorage`.
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
pause/resume.

The two-minute check:

1. `pnpm certs`, `pnpm build`, `pnpm start`.
2. Open the printed LAN URL on the host; trust the certificate.
3. Host **Create room**; verify the terminal prints a room URL, a phone
   controller URL and a room QR.
4. The guest either opens the room URL (desktop controls) or the controller URL
   (touch controls), then ready both; verify both canvases show the same room and
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
12. `pnpm check`: expect 30 test files and 380+ tests passing.

## Layout

```text
packages/shared      math, RNG, tuning, protocol messages, input/snapshot codecs
packages/sim         pure fixed-step football simulation and human actions
packages/server      HTTPS/WSS, sessions, rooms, input routing, match runner, QR
packages/client      LAN lobby, match client/interpolation, 2D renderer
  ├── controller     phone controller page (virtual stick + action buttons)
  ├── practice.html  offline M1 simulation
  └── link.html      M0 transport diagnostics
scripts              mkcert setup
certs                generated locally; ignored by git
```
