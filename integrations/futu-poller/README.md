# futu-poller — Futu holdings Service Plugin (tracer)

CM5-resident poller. Reads real positions from the pre-existing NAS
FutuOpenD gateway over the LAN and publishes bounded snapshots to the DeskOS
shell over a Unix socket (protocol v1, ADR 0009).

## Version pin (hard requirement)

The gateway runs Futu OpenD **10.2.6208**. The API client must match that
family or the handshake is rejected (`InitConnect check sha error`):

```
pip install "futu-api==10.2.6208"
```

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

# The socket path is declared once, in the shared file the shell also reads, so
the poller and the shell cannot disagree about it.
printf 'ODESK_FUTU_SOCKET=%s/open-deskos/futu-poller.sock\n' "$XDG_RUNTIME_DIR" >> ~/.config/open-deskos/runtime.env
chmod 600 ~/.config/open-deskos/runtime.env

# 4. run (tracer: foreground first, systemd unit arrives with T3)
set -a; . ~/.config/open-deskos/runtime.env; . ~/.config/open-deskos/futu-poller.env; set +a
~/.venv/futu/bin/python poller.py
```

Without `FUTU_TRADE_PWD` the poller reports `auth-required` and the tile
honestly shows "trade unlock needed".

## Shell side (tracer bootstrap)

The shell creates its socket server at the path `ODESK_FUTU_SOCKET` declares
(absolute, under `$XDG_RUNTIME_DIR/open-deskos/`), so the same declaration in
`runtime.env` serves both sides. Until the installer (T3) drives the
registry from the installed catalog, that variable is what registers the
`futu-poller` service. The Holdings page (`odk.tile.futu`) then renders live
data; any failure renders the honest `unavailable` state, never invented
numbers.

The shell's dev fallback declares revision `dev`, which is also the poller's
default. A packaged revision has to be declared on both sides (`SERVICE_REVISION`
for the poller and the shell's fallback) — that coupling is not yet derived from
one source.
