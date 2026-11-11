#!/usr/bin/env python3
"""Maze Rescue - tiny fallback server for a computer WITHOUT Node.js (used by start-mac.command / start-windows.bat).

    python3 server/fallback.py [port]          -> http://localhost:8787/   (this computer only: bound to 127.0.0.1)

It serves ONLY the game: index.html, js/, css/ and assets/. Nothing else in the folder can be read through it -
not config.local.js (it may hold the API key), not .git, not the tests.
There is no AI relay here, so the game runs in Demo mode. If config.local.js holds an API key, the key is NOT
passed on to the browser (a key in the browser can be read by any page); install Node.js to use the AI.
/config.local.js is generated: {offline: true} plus the speech settings of the real file.
Python 3 standard library only.
"""
import json, os, posixpath, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PUBLIC_DIRS = ('js', 'css', 'assets')
PUBLIC_FILES = ('index.html', 'config.example.js')
PASS_ON = ('speechInput', 'speechOutput')


def read_local_config():
    """Returns (has_key, settings). The file is JavaScript, so it is only searched for a few simple settings."""
    try:
        with open(os.environ.get('MR_LOCAL_CONFIG') or os.path.join(ROOT, 'config.local.js'), encoding='utf-8') as f:
            src = f.read()
    except OSError:
        return False, {}
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'(^|[^:])//[^\n]*', r'\1', src)
    has_key = bool(re.search(r'''apiKey["']?\s*:\s*(["'`])\s*[^"'`\s][^"'`]*\1''', src))
    settings = {}
    for name in PASS_ON:
        m = re.search(name + r'''["']?\s*:\s*(true|false)\b''', src)
        if m:
            settings[name] = m.group(1) == 'true'
    m = re.search(r'''speechLang["']?\s*:\s*["']([A-Za-z-]{2,10})["']''', src)
    if m:
        settings['speechLang'] = m.group(1)
    return has_key, settings


HAS_KEY, SETTINGS = read_local_config()


def public_path(url_path):
    """The file on disk for a URL path, or None when it is not part of the game."""
    try:
        rel = unquote(urlsplit(url_path).path, errors='strict')
    except (UnicodeDecodeError, ValueError):
        return None
    if '\0' in rel or '\\' in rel:
        return None
    rel = posixpath.normpath('/' + rel).lstrip('/')
    if rel in ('', '.'):
        rel = 'index.html'
    parts = rel.split('/')
    if any(p.startswith('.') for p in parts):
        return None
    if not (rel in PUBLIC_FILES or (parts[0] in PUBLIC_DIRS and len(parts) > 1)):
        return None
    full = os.path.realpath(os.path.join(ROOT, *parts))
    if not full.startswith(os.path.realpath(ROOT) + os.sep) or not os.path.isfile(full):
        return None
    return full


class Handler(SimpleHTTPRequestHandler):
    server_version = 'MazeRescueFallback/1'

    def _send(self, status, body, ctype):
        data = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def _route(self):
        """True when the request was answered here."""
        path = urlsplit(self.path).path
        if path == '/api/health':
            self._send(200, json.dumps({'ok': True, 'app': 'maze-rescue', 'ai': False, 'server': 'python'}, separators=(',', ':')), 'application/json; charset=utf-8')
            return True
        if path == '/config.local.js':
            cfg = dict(SETTINGS)
            cfg['offline'] = True
            self._send(200, 'window.MR_CONFIG = ' + json.dumps(cfg) + ';\n', 'text/javascript; charset=utf-8')
            return True
        if public_path(self.path) is None:
            self._send(404, 'Not found', 'text/plain; charset=utf-8')
            return True
        return False

    def do_GET(self):
        if not self._route():
            super().do_GET()

    def do_HEAD(self):
        if not self._route():
            super().do_HEAD()

    def do_POST(self):
        self._send(404, json.dumps({'error': 'no AI relay without Node.js'}), 'application/json; charset=utf-8')

    def translate_path(self, path):
        return public_path(path) or os.path.join(ROOT, 'does-not-exist')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):   # quiet: nothing about requests is written anywhere
        pass


def say(text):
    print(text, flush=True)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', '8787'))
    try:
        httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    except OSError:
        say('Port %d is busy - is Maze Rescue already open? Close the other window and start again.' % port)
        return 1
    say('Maze Rescue on http://localhost:%d/   (Python fallback, this computer only)' % port)
    if HAS_KEY:
        say('config.local.js has an API key, but without Node.js the key cannot stay on a server.')
        say('The key is NOT sent to the browser: the AI is OFF and the game runs in Demo mode.')
        say('Install Node.js (https://nodejs.org) and start again to use the AI.')
    else:
        say('AI: OFF - the game runs in Demo mode (install Node.js to use the AI relay).')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
