#!/usr/bin/env bash
set -euo pipefail

if [ "${ODK_MODEL_MIGRATION_LIBRARY:-0}" != "1" ] && [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: model storage migration updates /opt and /etc/fstab." >&2
  exit 1
fi

SSD_MOUNT="${ODK_MODEL_SSD_MOUNT:-/mnt/ssd}"
SSD_ROOT="${ODK_MODEL_SSD_ROOT:-${SSD_MOUNT}/open-deskos/models}"
FSTAB="${ODK_MODEL_FSTAB:-/etc/fstab}"
MARKER_BEGIN="# BEGIN open-deskos model storage"
MARKER_END="# END open-deskos model storage"

patch_ssd_fstab() {
  python3 - "$FSTAB" "$SSD_MOUNT" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
mountpoint = sys.argv[2]
lines = path.read_text().splitlines()
matched = False
for index, line in enumerate(lines):
    fields = line.split()
    if len(fields) < 4 or fields[1] != mountpoint:
        continue
    options = [item for item in fields[3].split(",") if item not in {"defaults", "umask=0000", "fmask=0000", "dmask=0000"}]
    for required in ("defaults", "nofail", "fmask=0133", "dmask=0022"):
        if required not in options:
            options.append(required)
    fields[3] = ",".join(options)
    lines[index] = " ".join(fields)
    matched = True
    break
if not matched:
    raise SystemExit(f"missing SSD mount entry for {mountpoint} in {path}")
path.write_text("\n".join(lines) + "\n")
PY
}

expected_fsroot() {
  destination=$1
  printf '/%s\n' "${destination#${SSD_MOUNT}/}"
}

mount_device() {
  path=$1
  source=$(findmnt -T "$path" -n -o SOURCE 2>/dev/null || true)
  printf '%s\n' "${source%%[*}"
}

intended_bind_is_active() {
  source=$1
  destination=$2
  [ "$(findmnt -T "$source" -n -o TARGET 2>/dev/null || true)" = "$source" ] &&
    [ "$(mount_device "$source")" = "$(mount_device "$SSD_MOUNT")" ] &&
    [ "$(findmnt -T "$source" -n -o FSROOT 2>/dev/null || true)" = "$(expected_fsroot "$destination")" ]
}

activate_read_only_bind() {
  source=$1
  destination=$2
  mount --bind "$destination" "$source"
  mount -o remount,bind,ro "$source"
}

verify_read_only_bind() {
  source=$1
  destination=$2
  intended_bind_is_active "$source" "$destination" || return 1
  findmnt -T "$source" -n -o OPTIONS | tr ',' '\n' | grep -qx ro
}

migrate_payload() {
  source=$1
  destination=$2
  backup="${source}.rootfs-backup"

  if intended_bind_is_active "$source" "$destination"; then
    mount -o remount,bind,ro "$source"
    if [ -d "$backup" ]; then
      rm -rf -- "$backup"
      echo "completed interrupted migration: ${source}"
    else
      echo "already mounted: ${source}"
    fi
    return
  fi
  if [ "$(findmnt -T "$source" -n -o TARGET 2>/dev/null || true)" = "$source" ]; then
    echo "unexpected mount is active at ${source}" >&2
    exit 1
  fi

  if [ -d "$backup" ]; then
    if [ ! -d "$destination" ]; then
      echo "SSD payload is missing while recovery backup exists: ${backup}" >&2
      exit 1
    fi
    mkdir -p "$source"
    activate_read_only_bind "$source" "$destination"
    verify_read_only_bind "$source" "$destination" || {
      umount "$source" || true
      rmdir "$source" || true
      mv "$backup" "$source"
      echo "bind mount recovery failed for ${source}" >&2
      exit 1
    }
    rm -rf -- "$backup"
    echo "recovered interrupted migration: ${source}"
    return
  fi

  if [ ! -d "$source" ]; then
    echo "model payload is missing: ${source}" >&2
    exit 1
  fi

  mkdir -p "$destination"
  rsync -rt --delete --checksum "${source}/" "${destination}/"
  differences=$(rsync -rni --delete --checksum "${source}/" "${destination}/")
  if [ -n "$differences" ]; then
    echo "migration verification failed for ${source}" >&2
    printf '%s\n' "$differences" >&2
    exit 1
  fi

  mv "$source" "$backup"
  mkdir -p "$source"
  if ! activate_read_only_bind "$source" "$destination" ||
     ! verify_read_only_bind "$source" "$destination"; then
    umount "$source" 2>/dev/null || true
    rmdir "$source" 2>/dev/null || true
    mv "$backup" "$source"
    echo "bind mount activation failed for ${source}" >&2
    exit 1
  fi
  rm -rf -- "$backup"
}

write_model_fstab() {
  fstab_block=$(cat <<EOF
${MARKER_BEGIN}
${SSD_ROOT}/rkllama /opt/rkllama/models none bind,ro,nofail,x-systemd.requires-mounts-for=${SSD_MOUNT} 0 0
${SSD_ROOT}/qwen3-asr-1.7b-rknn /opt/qwen3-asr-1.7b/rknn none bind,ro,nofail,x-systemd.requires-mounts-for=${SSD_MOUNT} 0 0
${MARKER_END}
EOF
)
  python3 - "$FSTAB" "$MARKER_BEGIN" "$MARKER_END" "$fstab_block" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
begin = sys.argv[2]
end = sys.argv[3]
block = sys.argv[4]
text = path.read_text()
start = text.find(begin)
if start >= 0:
    finish = text.find(end, start)
    if finish < 0:
        raise SystemExit(f"missing {end} in {path}")
    finish += len(end)
    prefix = text[:start].rstrip()
    suffix = text[finish:].strip("\n")
    text = "\n".join(part for part in (prefix, suffix) if part)
path.write_text(text.rstrip() + "\n" + block + "\n")
PY
}

if [ "${ODK_MODEL_MIGRATION_LIBRARY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

patch_ssd_fstab
if ! findmnt -T "$SSD_MOUNT" -n -o TARGET | grep -qx "$SSD_MOUNT"; then
  echo "SSD is not mounted at ${SSD_MOUNT}." >&2
  exit 1
fi
mkdir -p "$SSD_ROOT"

migrate_payload "/opt/rkllama/models" "${SSD_ROOT}/rkllama"
migrate_payload "/opt/qwen3-asr-1.7b/rknn" "${SSD_ROOT}/qwen3-asr-1.7b-rknn"
write_model_fstab

systemctl daemon-reload
mount -a
for path in /opt/rkllama/models /opt/qwen3-asr-1.7b/rknn; do
  findmnt -T "$path" -n -o TARGET,SOURCE,FSTYPE,OPTIONS
  findmnt -T "$path" -n -o OPTIONS | tr ',' '\n' | grep -qx ro
done

echo "model payload migration complete"
