/* Maze Rescue - local configuration TEMPLATE.
 *
 * To use the AI on ONE device (prototype / teacher's laptop):
 *   1. Copy this file to  config.local.js  (same folder as index.html). That file is git-ignored.
 *   2. Put your DeepSeek API key in apiKey below.
 *   3. Open index.html. The "Demo mode" badge disappears when a key or proxy is configured.
 *
 * For a whole class do NOT hand out the key. Run the relay instead:
 *   DEEPSEEK_API_KEY=... node server/proxy.js
 * and let the pupils open http://<teacher-laptop>:8787/ . The relay serves its own config.local.js
 * (proxyUrl only), so no key ever reaches a browser.
 *
 * Without config.local.js the game runs fully offline in "Demo mode" (keyword rules).
 * NEVER commit a real key. NEVER put a key in this example file.
 */
window.MR_CONFIG = {
  apiKey: '',                           // DeepSeek key, direct mode only (leave '' for Demo mode)
  baseUrl: 'https://api.deepseek.com',  // OpenAI-compatible base URL
  model: 'deepseek-flash',              // DeepSeek model IDs (api-docs.deepseek.com, Nov 2026): 'deepseek-flash' (fast) or 'deepseek-v4-pro'.
                                        // The game always sends thinking: disabled, so answers come back fast.
  proxyUrl: '',                         // e.g. '/api/chat' - when set, the key above is not used
  timeoutMs: 6000,                      // a slower answer counts as "Pip did not hear"
  temperature: 0.2,
  maxTokens: 400,
  offline: false,                       // true = force Demo mode even if a key is present

  speechInput: true,                    // microphone button (Web Speech API, if the browser has it)
  speechOutput: true,                   // Pip reads his lines aloud
  speechLang: 'en-US'
};
