# /// script
# requires-python = ">=3.11"
# dependencies = ["asyncssh==2.24.1"]
# ///
"""Loopback-only SSH fixture. It can start only the supplied Pi daemon."""

import argparse
import asyncio
import contextlib
import json
import os
from pathlib import Path
import re
import shlex
import sys

import asyncssh


async def run_fixture(root: Path, daemon: Path) -> None:
    client_key = asyncssh.generate_private_key("ssh-ed25519")
    host_key = asyncssh.generate_private_key("ssh-ed25519")
    wrong_host_key = asyncssh.generate_private_key("ssh-ed25519")
    identity = root / "client-key"
    identity.write_bytes(client_key.export_private_key())
    identity.chmod(0o600)
    children: set[asyncio.subprocess.Process] = set()
    connections: set[asyncssh.SSHServerConnection] = set()

    class FixtureServer(asyncssh.SSHServer):
        def connection_made(self, connection: asyncssh.SSHServerConnection) -> None:
            connections.add(connection)

        def begin_auth(self, username: str) -> bool:
            return True

        def public_key_auth_supported(self) -> bool:
            return True

        def validate_public_key(self, username: str, key: asyncssh.SSHKey) -> bool:
            return username == "fixture" and key == client_key.convert_to_public()

    async def handle(process: asyncssh.SSHServerProcess[bytes]) -> None:
        if "ODK_FIXTURE_CLIENT_ONLY" in process.env:
            process.exit(125)
            return
        args = shlex.split(process.command or "")
        if args == ["/fixture/control"]:
            request = json.loads(await process.stdin.read(65537))
            if request.get("command") != "list" or request.get("project") != str(root):
                process.exit(126)
                return
            process.stdout.write(json.dumps({"version": 1, "requestId": request["requestId"], "ok": True, "task": request}).encode())
            process.exit(0)
            return
        if len(args) != 4 or args[:3] != [str(daemon), "serve", "--token"] or not re.fullmatch(r"[0-9a-f]{32}", args[3]):
            process.exit(126)
            return
        child = await asyncio.create_subprocess_exec(
            *args, cwd=root, env={"HOME": str(root), "PATH": os.defpath},
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        children.add(child)
        with (root / "daemon-starts.jsonl").open("a", encoding="utf-8") as audit:
            audit.write(json.dumps({"pid": child.pid}) + "\n")
        try:
            await process.redirect(stdin=child.stdin, stdout=child.stdout, stderr=child.stderr)
            process.exit(await child.wait())
        finally:
            if child.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    child.terminate()
            await child.wait()
            children.discard(child)

    server = await asyncssh.listen(
        "127.0.0.1", 0, server_factory=FixtureServer, server_host_keys=[host_key],
        process_factory=handle, encoding=None,
    )
    print(json.dumps({
        "port": server.get_port(), "identity": str(identity),
        "hostKey": host_key.export_public_key().decode().strip(),
        "wrongHostKey": wrong_host_key.export_public_key().decode().strip(),
    }), flush=True)
    try:
        reader = asyncio.StreamReader()
        transport, _ = await asyncio.get_running_loop().connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(reader), sys.stdin.buffer,
        )
        try:
            await reader.read()
        finally:
            transport.close()
    finally:
        server.close()
        await server.wait_closed()
        for connection in connections:
            connection.close()
        await asyncio.gather(*(connection.wait_closed() for connection in connections))
        for child in children:
            if child.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    child.terminate()
        await asyncio.gather(*(child.wait() for child in children))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--daemon", type=Path, required=True)
    arguments = parser.parse_args()
    asyncio.run(run_fixture(arguments.root.resolve(), arguments.daemon.resolve()))
