# recall-bridge

Chrome native messaging host for the [Recall](https://github.com/ty-asuralo/recall) extension. Reads the raw JSONL that Recall captures from Claude, ChatGPT, and Gemini; pushes it into a local retrieval backend (MemPalace or GBrain); and routes search queries from the extension back to that backend.

The bridge is a small Node binary. Chrome launches it on demand over stdio. It is never contacted over the network and stores nothing beyond a small config file.

## Install

### Option 1: Homebrew (macOS)

```bash
brew tap ty-asuralo/tap
brew install recall-bridge
```

This installs the binary, registers the Chrome native messaging host, and prints setup instructions. Run `brew info recall-bridge` to see them again.

### Option 2: npm (macOS / Linux / Windows)

```bash
npm install -g recall-bridge
```

This installs the binary globally and auto-registers the Chrome native messaging host on macOS/Linux. On Windows, run `install\install.ps1` after to register via the registry.

After either method, edit the native host manifest to set your Recall extension ID (find it in `chrome://extensions` with developer mode on).

### Option 3: From source

```bash
git clone https://github.com/ty-asuralo/recall-bridge
cd recall-bridge
npm install
npm run build
./install/install.sh
```

The installer will:

1. Build the binary if it isn't built.
2. Write a shim at `bin/recall-bridge`.
3. Write Chrome's native messaging host manifest.
4. Prompt you for your backend (MemPalace / GBrain / Mock) and your Recall raw export directory.
5. Write `~/.config/recall-bridge/config.json`.

Set `RECALL_EXTENSION_ID=<your extension id>` before running the installer to pre-fill the `allowed_origins` field.

### Windows (from source)

```powershell
git clone https://github.com/ty-asuralo/recall-bridge
cd recall-bridge
npm install
npm run build
.\install\install.ps1
```

The Windows installer writes the manifest under `%APPDATA%\Google\Chrome\NativeMessagingHosts\` and registers it in `HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.recall.bridge`.

## Backends

- **MemPalace** — Python, [on PyPI](https://pypi.org/project/mempalace/). Bridge shells out to `mempalace mine <staging> --mode convos --wing recall` for ingest and `mempalace search <query> --json` for queries.
- **GBrain** — TypeScript, installed from GitHub via [Bun](https://bun.sh). Bridge shells out to `gbrain import <staging>` and `gbrain search <query> --json`.
- **Mock** — returns canned hits, for developing the extension without installing either tool.

### Auto-install

The installer (`install/install.sh` / `install/install.ps1`) prompts you to pick a backend and — if the corresponding CLI isn't already on `PATH` — offers to install it for you:

| Backend    | Install channel (in order of preference)                      | Required prerequisite |
|------------|---------------------------------------------------------------|-----------------------|
| MemPalace  | `pipx install mempalace` → `pip3 install --user mempalace`    | Python 3.9+           |
| GBrain     | `bun add -g github:garrytan/gbrain`                           | Bun runtime           |
| Mock       | (none)                                                        | (none)                |

Every install step is gated by a `[y/N]` prompt showing the exact command before it runs. The installer refuses to touch language runtimes on your behalf — if Python, pipx, or Bun is missing, it prints the one-line command to install it (e.g. `brew install pipx`, `curl -fsSL https://bun.sh/install | bash`) and exits so you can install it yourself and re-run.

After install, the installer verifies the CLI is reachable (`mempalace --version` / `gbrain --version`). If the binary installed but isn't on `PATH` (common with `pip --user` or `bun -g`), the installer prints the `PATH` addition you need and aborts — it will not write a config file pointing at a broken backend.

### Switching backends

After the initial install you can switch backends without reinstalling the bridge itself: edit `~/.config/recall-bridge/config.json`, change `backend` to `mempalace` / `gbrain` / `mock`, and click **Test connection** in the Recall extension's Settings. If the new backend's CLI isn't installed, either re-run `install/install.sh` (which will offer to install it) or install it manually.

## Config

`~/.config/recall-bridge/config.json`:

```json
{
  "version": 1,
  "backend": "mempalace",
  "exportDir": "/Users/you/Documents/recall",
  "lastIngestedAt": 0
}
```

`exportDir` must be the same directory Recall writes its raw JSONL into — the bridge walks `{exportDir}/claude/*.jsonl`, `{exportDir}/chatgpt/*.jsonl`, `{exportDir}/gemini/*.jsonl`. `lastIngestedAt` is an epoch-ms cursor the bridge advances automatically.

## Protocol

The bridge speaks the Chrome native messaging framing: a 4-byte little-endian length prefix followed by a UTF-8 JSON body. Requests and responses are defined in `src/protocol.ts`. Request types: `ping`, `capabilities`, `ingest`, `search`, `conversation`.

Every request includes an `id`; every response echoes it back. Errors are always `{ id, ok: false, error: { code, message } }` — the bridge never crashes on a bad request.

## Develop

```bash
npm run dev       # tsc --watch
npm run typecheck # one-shot tsc --noEmit
npm test          # framing round-trip + ping end-to-end
```

Manual ping check:

```bash
npm run build
node -e 'const b=Buffer.from(JSON.stringify({id:"x",type:"ping"}));const h=Buffer.alloc(4);h.writeUInt32LE(b.length,0);process.stdout.write(Buffer.concat([h,b]))' | node dist/index.js | xxd
```

You should see a 4-byte length prefix followed by a JSON response containing `"ok":true` and a `now` timestamp.

## License

MIT.
