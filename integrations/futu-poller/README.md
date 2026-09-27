# futu-poller — Futu holdings Service Plugin

CM5-resident poller. Reads real positions from the pre-existing NAS FutuOpenD
gateway over the LAN and publishes bounded snapshots to one or more DeskOS
shells over a runtime channel (protocol v1, ADR 0009).

The transport is an endpoint, not a Unix socket path, so one poller feeds both
the reference desk and a second desk on a 64-bit Windows handheld without any
platform-specific code. The gateway RSA key and trade password stay on the
reference host: the desks only receive positions.

## Version pin (hard requirement)

The gateway runs Futu OpenD **10.2.6208**. The API client must match that
family or the handshake is rejected (`InitConnect check sha error`):

```
pip install "futu-api==10.2.6208"
```

## Endpoints

A target's `endpoint` is one of three forms. The token rule follows the desk's
own `local-channel` handshake: a Unix socket is authenticated by filesystem
ownership, so the poller sends no handshake there and the desk still accepts it.

| Endpoint | Example | Token |
| --- | --- | --- |
| Unix socket path | `/run/user/1000/open-deskos/futu-poller.sock` | no |
| Windows named pipe | `\\.\pipe\open-deskos-futu-poller` | yes |
| TCP address | `tcp://100.82.50.70:8790` | yes |

For a pipe or `tcp://` endpoint the poller sends the shared channel handshake
as the connection's first line, byte for byte as the desk writes it:

```json
{"v":1,"token":"<token>"}
```

then the protocol v1 records (`hello`, `data`, `error`, `auth-required`) as
before. The token comes from the target's `tokenFile`, falling back to
`ODK_CHANNEL_TOKEN_FILE`; it is trimmed, and a missing or empty file is refused
with a reason on stderr rather than sent as a bad handshake. The reference host
never needs that file for its own Unix socket.

Each target has its own connection and its own reconnect state. One desk being
unreachable never breaks the others; a connect attempt is bounded by the
poller's connect timeout (10 s), so an unreachable host cannot hold the poll
open forever.

## Deploy on the CM5

```sh
# 1. environment
python3 -m venv ~/.venv/futu && ~/.venv/futu/bin/pip install -r requirements.txt

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

`ODESK_FUTU_TARGETS_FILE` overrides the targets file location (default
`~/.config/open-deskos/futu-targets.json`). When there is no targets file, the
single-target environment form keeps working unchanged: `ODESK_FUTU_SOCKET` is
a socket path and the poller sends no handshake for it.

The socket path the local desk binds is declared once, in the shared file the
shell also reads, so the poller and the shell cannot disagree about it:

```sh
printf 'ODESK_FUTU_SOCKET=%s/open-deskos/futu-poller.sock\n' "$XDG_RUNTIME_DIR" >> ~/.config/open-deskos/runtime.env
chmod 600 ~/.config/open-deskos/runtime.env
```

Without `FUTU_TRADE_PWD` the poller reports `auth-required` to every desk and
the tile honestly shows "trade unlock needed".

## systemd user unit

`open-deskos-futu-poller.service` is the resident unit. It runs the venv python
against `poller.py`, loads `futu-poller.env` and `runtime.env`, and restarts
always with `RestartSec=5`. The unit is a template: the installer substitutes
`__OPEN_DESKOS_FUTU_POLLER_DIR__` with the installed integration path, the same
pattern the other integration units use. A manual install is:

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

The shell connects to the path `ODESK_FUTU_SOCKET` declares (absolute, under
`$XDG_RUNTIME_DIR/open-deskos/`), so one declaration in `runtime.env` serves
both sides and neither can drift from the other. Until the installer (T3) drives
the registry from the installed catalog, that variable is what registers the
`futu-poller` service. The Holdings page (`odk.tile.futu`) then renders live
data; any failure renders the honest `unavailable` state, never invented
numbers.

A packaged revision is declared once too: set `ODESK_FUTU_SERVICE_REVISION` in
`runtime.env`, and both the poller's handshake and the shell's expectation use
that value instead of two copies of `dev`.

## Tests

The transport tests drive the real client against a socket server started in the
test; no gateway and no futu SDK are needed:

```sh
python3 -m pytest integrations/futu-poller/tests -q
```

They cover the Unix socket, the TCP handshake, the missing/empty token refusal,
two desks receiving the same records with one refusing connections, and a
malformed target being refused by name while the others run.