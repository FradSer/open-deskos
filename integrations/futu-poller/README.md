# futu-poller — Futu holdings Service Plugin

CM5-resident poller.
It reads real positions from the existing NAS FutuOpenD gateway over the LAN.
It publishes bounded protocol-v1 snapshots through a Runtime Channel to one or more Shell Hosts.
See [ADR-0009](../../runtime/shell/docs/ARCHITECTURE.md#adr-0009).

One poller feeds Linux and Windows endpoint targets.
Gateway RSA/trade credentials stay on the reference host; desks receive positions only.

## Version pin (hard requirement)

The gateway runs Futu OpenD **10.2.6208**.
The API client must match that family or the handshake is rejected (`InitConnect check sha error`):

```sh
uv pip install "futu-api==10.2.6208"
```

## Endpoints

A target's `endpoint` is one of three forms.
The token rule uses the `local-channel` handshake.
Filesystem ownership authenticates Unix sockets; they need no token handshake.

| Endpoint | Example | Token |
| --- | --- | --- |
| Unix socket path | `/run/user/1000/open-deskos/futu-poller.sock` | no |
| Windows named pipe | `\\.\pipe\open-deskos-futu-poller` | yes |
| TCP address | `tcp://100.82.50.70:8790` | yes |

For a pipe or `tcp://` endpoint, send the exact shared handshake as the first line:

```json
{"v":1,"token":"<token>"}
```

then the protocol v1 records (`hello`, `data`, `error`, `auth-required`) as before.
Read the trimmed token from `tokenFile`, or fall back to `ODK_CHANNEL_TOKEN_FILE`.
A missing/empty token is refused with a reason on stderr.
The reference host never needs that file for its own Unix socket.

Each target has its own connection and its own reconnect state.
An unreachable desk does not block other desks.
Each connection attempt has a 10-second timeout.
A mid-record disconnect records failure only for that desk.
Other desks still receive the record.
Log the reason after three consecutive failed polls; routine reconnects remain quiet.

## Deploy on the CM5

These commands change device configuration/services and require operational authorization; transport tests below are isolated.

```sh
# 1. environment
uv venv ~/.venv/futu
uv pip install --python ~/.venv/futu/bin/python -r requirements.txt

# 2. gateway RSA key (client copy; treat as a secret, mode 0600).
#    Source: frad-nas:/mnt/user/appdata/futuopend/config/rsa_private.pem
install -m 600 rsa_private.pem ~/.config/open-deskos/futu-rsa.pem

# 3. configuration (mode 0600; values never enter the package)
cat > ~/.config/open-deskos/futu-poller.env <<'EOF'
FUTU_HOST=10.10.0.195
FUTU_PORT=11111
FUTU_RSA_FILE=$HOME/.config/open-deskos/futu-rsa.pem
FUTU_TRADE_PWD=<trade-unlock-password>
FUTU_INTERVAL=60
SERVICE_ID=futu-poller
EOF
chmod 600 ~/.config/open-deskos/futu-poller.env

# 4. the desks to feed. `name` is optional and only labels the target in logs.
cat > ~/.config/open-deskos/futu-targets.json <<'EOF'
{"targets":[
  {"name":"local","endpoint":"/run/user/1000/open-deskos/futu-poller.sock"},
  {"name":"handheld","endpoint":"tcp://100.82.50.70:8790",
   "tokenFile":"/home/orangepi/.config/open-deskos/handheld-channel.token"}
]}
EOF
chmod 600 ~/.config/open-deskos/futu-targets.json
```

`ODESK_FUTU_TARGETS_FILE` overrides the targets file location (default `~/.config/open-deskos/futu-targets.json`).
Without a targets file, `ODESK_FUTU_SOCKET` selects the single Unix socket.
It needs no token handshake.

Declare the shared socket once in `runtime.env`:

```sh
printf 'ODESK_FUTU_SOCKET=%s/open-deskos/futu-poller.sock\n' "$XDG_RUNTIME_DIR" >> ~/.config/open-deskos/runtime.env
chmod 600 ~/.config/open-deskos/runtime.env
```

Without `FUTU_TRADE_PWD` the poller reports `auth-required` to every desk and the tile honestly shows "trade unlock needed".

## systemd user unit

`open-deskos-futu-poller.service` is the resident unit.
It runs the venv python against `poller.py`, loads `futu-poller.env` and `runtime.env`, and restarts always with `RestartSec=5`.
The unit is a template: the installer substitutes `__OPEN_DESKOS_FUTU_POLLER_DIR__` with the installed integration path, the same pattern the other integration units use.
A manual install is:

```sh
mkdir -p ~/.config/systemd/user
sed "s|__OPEN_DESKOS_FUTU_POLLER_DIR__|$PWD|g" \
  integrations/futu-poller/open-deskos-futu-poller.service \
  > ~/.config/systemd/user/open-deskos-futu-poller.service
systemctl --user daemon-reload
systemctl --user enable --now open-deskos-futu-poller.service
journalctl --user -u open-deskos-futu-poller.service -f
```

## Shell side (tracer bootstrap)

`ODESK_FUTU_SOCKET` is absolute under `$XDG_RUNTIME_DIR/open-deskos/` and currently registers the service.
Holdings (`odk.tile.futu`) renders live positions or truthful unavailable state.

Set `ODESK_FUTU_SERVICE_REVISION` once in `runtime.env`.
The poller handshake and Shell expectation share that revision instead of separate `dev` values.

## Tests

The transport tests drive the real client against a socket server started in the test; no gateway and no futu SDK are needed:

```sh
uv run --with pytest pytest integrations/futu-poller/tests -q
```

They cover Unix sockets, TCP handshakes, and missing/empty tokens.
Multi-desk fixtures cover connection refusal, mid-record resets, and named malformed-target failures while other desks remain fed.
