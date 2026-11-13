/* Maze Rescue - PUBLIC configuration of the web version (committed; it holds NO key).
 * On the published site (GitHub Pages) the AI goes through the Cloudflare relay in cloud/ (the key is a secret
 * there). Put the relay's address below after deploying it (cloud/README.md). Empty = the web version uses the
 * offline rules. Local copies (file://, http://localhost:8787 with start-mac.command) are not affected:
 * there config.local.js / server/proxy.js decide.
 */
(function () {
  var RELAY = 'https://muze-ai.sleepypao-muze.workers.dev/api/chat';
  if (!window.MR_CONFIG && RELAY && window.location.hostname === 'sleepypao.github.io') window.MR_CONFIG = { proxyUrl: RELAY };
})();
