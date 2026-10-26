"""Create a private S3 NVS image from the gateway's private configuration."""
import argparse
import csv
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


def create_image(config_file: Path, gateway_mac: str, output: Path, idf_path: Path) -> None:
    """Create a new image. Never overwrite a backup or print pairing keys."""
    if not config_file.is_absolute() or not output.is_absolute() or not idf_path.is_absolute():
        raise ValueError('absolute-path-required')
    if not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}', gateway_mac):
        raise ValueError('invalid-gateway')
    gateway = bytes.fromhex(gateway_mac.replace(':', ''))
    if gateway[0] & 1 or not any(gateway):
        raise ValueError('invalid-gateway')
    fd = os.open(config_file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 16384 or info.st_mode & 0o077 or info.st_uid != os.getuid():
            raise ValueError('configuration-not-private')
        with os.fdopen(fd, 'r', closefd=False) as stream:
            config = json.load(stream)
    finally:
        os.close(fd)
    peers = config.get('peers', [])
    channel = config.get('channel', 1)
    if len(peers) != 1 or type(channel) is not int or not 1 <= channel <= 11:
        raise ValueError('one-encrypted-peer-required')
    pmk, lmk = config.get('pmk'), peers[0].get('lmk')
    if not all(isinstance(key, str) and re.fullmatch(r'[0-9a-fA-F]{32}', key) for key in (pmk, lmk)):
        raise ValueError('invalid-key')
    generator = idf_path / 'components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py'
    if not generator.is_file():
        raise ValueError('missing-idf-generator')
    parent = output.parent.stat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077 or parent.st_uid != os.getuid():
        raise ValueError('output-directory-not-private')
    # Reserve the output before running the generator. Both files stay mode 0600.
    out_fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(out_fd)
    try:
        with tempfile.NamedTemporaryFile(mode='w', newline='', dir=output.parent, prefix='.odk-pairing-', suffix='.csv') as source:
            writer = csv.writer(source)
            writer.writerows([['key', 'type', 'encoding', 'value'], ['odk_radio', 'namespace', '', ''],
                              ['gateway', 'data', 'hex2bin', gateway.hex()], ['pmk', 'data', 'hex2bin', pmk],
                              ['lmk', 'data', 'hex2bin', lmk], ['channel', 'data', 'u8', channel]])
            source.flush()
            subprocess.run([sys.executable, str(generator), 'generate', source.name, str(output), '0x6000'],
                           check=True, capture_output=True, timeout=30)
        os.chmod(output, 0o600)
    except BaseException:
        output.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gateway-config', required=True, type=Path)
    parser.add_argument('--gateway-mac', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--idf-path', required=True, type=Path)
    args = parser.parse_args()
    try:
        create_image(args.gateway_config, args.gateway_mac, args.output, args.idf_path)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        print('Pairing image creation failed. Check private configuration, output, and IDF installation.', file=sys.stderr)
        return 1
    print('Private pairing image created. Verify the S3 NVS offset before flashing.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
