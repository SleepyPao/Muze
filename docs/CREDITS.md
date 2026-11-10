# Credits and licences

## Art
All pixel art (Pip, the portraits and their five expressions, items, landmarks, hedges, paths, effects)
is **original** and drawn in code in `js/sprites.js` and `js/render.js` for this project. No image files
and no third-party sprites are used. Pip is an original character and is not based on any existing game
character.

## Music and sound effects
Synthesised at run time with the Web Audio API (`js/audio.js`). The music loop is an original tune
written for this project. No sound files are used.

## Pip's voice
`assets/voice/*.mp3` were generated offline with **Piper** text-to-speech
(https://github.com/OHF-Voice/piper1-gpl) using the voice model **en_US-kristin-medium**
(https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/kristin/medium).
Model card: "US English female voice … All recordings came from LibriVox.org", dataset licence: **public
domain**. Piper was used only as a tool on the developer's computer; it is not part of the game and is
not distributed with it. MP3 encoding: `lameenc` (LGPL), also only a build-time tool.

## Fonts
No font files. The game uses fonts already on the device (rounded system fonts where available).

## Code
All code in this repository was written for this project. Development and tests use Playwright
(Apache-2.0) as a dev dependency only.
