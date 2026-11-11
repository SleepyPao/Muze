# Maze Rescue – architecture

Plain HTML / CSS / JavaScript. No build step, no framework, no runtime dependency, no CDN.
`index.html` works when opened straight from disk (`file://`) without a network, so everything is
loaded with classic `<script>` tags onto one global namespace, `window.MR`. Data lives in JS files,
not JSON, because browsers block `fetch()` of local files.

**Single player.** One pupil plays everything: 4 things + 2 routes. A pupil is identified only by a
class number (e.g. `5A-12`). There is no `player` field anywhere.

## Files and load order

| # | File | What it does | Pure (Node-testable) |
|---|------|--------------|:---:|
| 1 | `js/core.js` | namespace, events (`MR.on/emit`), utils, `MR.storage` (localStorage with memory fallback) | ✓ |
| 2 | `js/maze.js` | grid helpers: tiles, BFS, junctions, landmarks "at" / "ahead", `minInstructions` | ✓ |
| 3 | `js/data.js` | the **closed** fact table, Go maps, Guide mazes (2 routes × standard/simple), warm-up, hints, every canned line | ✓ |
| 4 | `js/rules.js` | offline rules: Ask classifier + Guide parser (spec §8) | ✓ |
| 5 | `js/guide-engine.js` | executes Guide actions, walls, exit, the left/right rule, `replay()` from logs | ✓ |
| 6 | `js/state.js` | the pupil's session, saved per class number, resume, `nextScreen()` | ✓ |
| 7 | `js/log.js` | append-only evidence log (spec §5.3), stage locks, aggregation, rubric, JSON/CSV | ✓ |
| 8 | `js/ai.js` | the only place that talks to a model (DeepSeek, OpenAI-compatible); falls back to rules | ✓ |
| 9 | `js/voice-data.js` | GENERATED: Pip's pre-recorded lines, text → `[mp3, seconds]` | – |
| 10 | `js/speech.js` | speech recognition (input) and Pip's voice (output) | – |
| 11 | `js/sprites.js` | all pixel art, drawn in code (Pip, items, landmarks, portraits) | – |
| 12 | `js/render.js` | scene renderer (3/4 top-down, square grid, y-sorted), tweening, particles | – |
| 13 | `js/audio.js` | WebAudio chiptune + sound effects, mute | – |
| 14 | `js/ui.js` | router (`MR.go`, `MR.next`), top bar, wooden dialog bar, overlay, toast | – |
| 15 | `js/screens/*.js` | `start`, `warmup`, `ask`, `go`, `sessionbreak`, `guide`, `review`, `teacher` | – |
| 16 | `js/main.js` | boot, URL flags, debug deeplinks, example evidence | – |

CSS: `css/base.css` (layout), `css/theme.css` (look), `css/screen-<name>.css` (one per screen).

## Flow

```
start → warmup → (ask → go) × 4 → sessionbreak   [end of lesson 1, saved]
      → guide r1 → guide r2 → review → start      [lesson 2]
teacher view: from the Start screen ("Teacher" button, light gate)
```

`MR.state.nextScreen()` decides where a pupil goes; every screen ends with `MR.next()`.
Typing the same class number again resumes the saved game.

## Key APIs

```js
MR.go(name, params) / MR.next()
MR.screens.register(name, { mount(el, params), unmount() })

MR.ui.dialog.show({input, hint, placeholder, emotion}); say(text, {emotion}) -> Promise (text shown AND voice finished)
MR.ui.dialog.onSend(fn({text, input_mode, asr_text})); onHint(fn); setBusy(bool); setActions([...])
MR.ui.overlay.show({title, text, itemId, stars, button}) -> Promise

MR.ai.ask({item, given, text})   -> {category, reply, grammar_note, fact_given, clarification, failed, source}
MR.ai.guide({text, run, visible, ctx}) -> {actions, clarify, clarifyKind, failed, source}
MR.guide.execute(maze, run, actions) -> {status:'ok'|'wall'|'clarify'|'exit'|'invalid', steps, say, note, clarify, pending}

MR.render.createScene(container, map, opts) -> scene: setPip, walk(path)->Promise, turn, bump, emote,
    setHighlights, setMarkers, onTileClick, setTrail, pickupItem, burst, tileRect, debugState, destroy
MR.render.drawPortrait(canvas, 'neutral'|'happy'|'confused'|'thinking'|'surprised')

MR.log.askTurn / goChoice / guideTurn / hint / event / lockStage / aggregate / toCSV / exportJSON / importJSON
```

## Who decides what (spec §2.7, §6)

* The model only **classifies** (Ask) or **parses** (Guide). It never decides right / wrong.
* Facts shown to the pupil are always the canonical strings from `data.js` (`MR.rules.composeAsk`),
  never model text. So no item or place outside the fact table can appear.
* Model-written clarifications / redirects must pass `MR.ai.validateReply` (short, A2 words, no fact
  leakage) or a canned line is used.
* Single words and fragments ("Where", "Where key?") never reach the model: the rules ask back.
* Empty / invalid / slow (> 6 s) model answers → "Sorry, can you say that again?" (logged as `ai_failed`,
  not as a pupil error). Two failures in a row → offline rules for the rest of the session.
* Only the pupil's sentence and the fact table are sent. Never the class number.

## Left / right rule

"left" / "right" mean **Pip's** left / right, the way directions work for the walker.

* **Warm-up:** Pip always walks away from the viewer, so the pupil's left and Pip's left are the same.
  A warm-up answer never depends on whose left is meant (Pip cannot ask back there). A unit test enforces this.
* **Guide:** when Pip faces the viewer (down the screen), "left" can mean two things (spec 4.4). The first
  unqualified turn in that position makes Pip ask "My left or your left?" and wait.
  "your left" = Pip's left; "my left" = the pupil's left (mirrored; the first time Pip says
  "OK! Your left is my right now."). **Pip remembers the answer for the rest of the route** and never asks
  again or silently switches meaning. Facing left / right (E / W), a turn is Pip's own turn.
* A yellow chevron on the map always shows where Pip is looking.

## Pip's voice (offline)

* Every fixed line (canned text, facts, warm-up instructions, screen lines – 68 lines) is pre-recorded
  as a small MP3 in `assets/voice/`, made **offline** with Piper TTS (female voice "kristin", trained on
  public-domain LibriVox recordings). Playing them needs no network. Regenerate with
  `tools/voice/make_voice.py` (see `tools/voice/README.md`).
* Lines written by the AI at run time use an **on-device** system voice only (`localService === true`,
  female if available). Network voices are never chosen. If there is none, Pip is silent (text is always shown).
* The typewriter text is paced to the clip length; `say()` resolves when the voice ends; a new line
  stops the old one; music gets quieter while Pip talks.
* Speech **input** uses the browser's recogniser (the recognised text goes into the box for the pupil to
  check). Note: Chrome's recogniser sends audio to Google (open question in spec §7). Turn it off with
  `speechInput: false` in `config.local.js`; typing always works.
* **Microphone permission:** Chrome does not remember permissions for pages opened as files (`file://`),
  so it asks on every Speak. `start-mac.command` / `start-windows.bat` serve the game from
  `http://localhost:8787/` (server/proxy.js, bound to 127.0.0.1), where "Allow on every visit" is kept.
  The relay also reads `apiKey` from `config.local.js` on the server side, so the key never reaches the browser.

## Debug deeplinks

`index.html?debug=<screen>` jumps to a screen with a seeded pupil in memory storage (nothing saved):

| URL | Shows |
|-----|-------|
| `?debug=ask&item=2&facts=name,look` | Ask, third thing, two facts known |
| `?debug=go&item=0` | Go for the key |
| `?debug=guide&route=1&difficulty=simple` | Guide route 2, simple maze |
| `?debug=review` / `?debug=teacher` | filled with example evidence for 3 pupils |

Other flags: `fast=1` (no typing effect, instant walking, no voice), `offline=1` (force Demo mode),
`memory=1` (do not touch localStorage).

## Tests

```
npm test             # 56 unit tests (Node: pure logic + relay)
npm run test:e2e     # full playthrough in headless Chromium, network blocked (141 checks)
node tools/shot.js "?debug=go&item=1" out.png    # screenshot helper
```
