# brow

Download, manage and launch multiple versions of Chrome & Firefox for web compatibility testing.

All browser binaries, profiles and cache are stored in `~/.brow/` — no system pollution.

## Install

```bash
npm install -g brow-manager
```

## Usage

```bash
# Interactive search & install
brow install chromium
brow install firefox

# Install specific version
brow install chromium 120
brow install firefox 128.0
brow install chromium latest

# Browse all available versions
brow available chromium
brow available firefox

# List installed browsers
brow list

# Launch
brow launch chromium
brow launch chromium 120
brow launch firefox --profile dev

# Remove
brow remove chromium 120

# Manage profiles
brow profiles
brow profile rm chromium dev

# Clear version cache
brow cache clear
```

## Version coverage

| Browser  | Range          | Source                                       |
|----------|----------------|----------------------------------------------|
| Chromium | 113 – latest   | [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) |
| Chromium | 59 – 112       | [Chromium Snapshots](https://commondatastorage.googleapis.com/chromium-browser-snapshots/) |
| Firefox  | 1.0 – latest   | [Mozilla Archive](https://archive.mozilla.org/pub/firefox/releases/) |

## How it works

- **Install**: Downloads official browser builds and extracts them to `~/.brow/browsers/<browser>-<version>/`
- **Launch**: Starts the browser with an isolated profile directory at `~/.brow/profiles/<browser>/<profile>/`, so each version and profile is fully sandboxed
- **Profiles**: Each `--profile <name>` gets its own bookmarks, cookies, extensions, etc. Default profile is `default`

## Requirements

- macOS (uses `hdiutil` for Firefox `.dmg` extraction)
- Node.js >= 18 or Bun
- `curl` and `unzip` (pre-installed on macOS)

## Data directory

```
~/.brow/
├── browsers/          # Browser binaries
│   ├── chromium-120.0.6099.234/
│   └── firefox-128.0/
├── profiles/          # Isolated browser profiles
│   ├── chromium/
│   │   ├── default/
│   │   └── dev/
│   └── firefox/
│       └── default/
├── cache/             # Version list cache (24h TTL)
└── tmp/               # Temporary downloads (auto-cleaned)
```

## License

MIT
