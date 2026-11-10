# Pip's voice – how to regenerate

Pip's fixed lines are pre-recorded MP3 files (`assets/voice/`) listed in `js/voice-data.js`.
They are made offline with Piper TTS; nothing is sent to any server. Regenerate after changing any
line Pip says (in `js/data.js` or a `ui.dialog.say('…')` in `js/screens/`).

```bash
python3 -m venv .venv-voice && .venv-voice/bin/pip install piper-tts lameenc
# voice model (63 MB, not committed):
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kristin/medium/en_US-kristin-medium.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kristin/medium/en_US-kristin-medium.onnx.json
# espeak-ng fails on long paths (> 160 chars): copy its data somewhere short if needed
cp -R .venv-voice/lib/python3*/site-packages/piper/espeak-ng-data /tmp/ed
.venv-voice/bin/python tools/voice/make_voice.py --model en_US-kristin-medium.onnx --espeak-data /tmp/ed
```

Options: `--length-scale 1.1` (higher = slower, clearer), `--volume 0.85`, `--kbps 48`.

`node tools/voice/lines.js` prints the list of lines that will be recorded. The end-to-end test fails if
Pip says a fixed line that has no clip.
