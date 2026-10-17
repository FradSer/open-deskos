"""Private proc fixtures exercise observation without accessing the host GPU."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('observer', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='odk-xorg-observer-') as directory:
    root = Path(directory)
    m.PROC, m.MODULE, m.XORG = root/'proc', root/'libglamoregl.so', root/'Xorg'
    m.MODULE.write_bytes(b'module'); m.XORG.write_bytes(b'Xorg')
    (m.PROC/'sys/kernel/random').mkdir(parents=True)
    boot = m.PROC/'sys/kernel/random/boot_id'
    boot.write_text('00000000-0000-0000-0000-000000000001\n')
    proc = m.PROC/'101'; proc.mkdir(); (proc/'exe').symlink_to(m.XORG)
    start = proc/'stat'; start.write_text('101 (Xorg) '+' '.join(['S']+['0']*18+['123']))
    maps = proc/'maps'; info = m.MODULE.stat()
    mapping = f'1000-2000 r-xp 0 {os.major(info.st_dev):x}:{os.minor(info.st_dev):x} {info.st_ino} {m.MODULE}\n'
    maps.write_text(mapping)
    real_trusted, real_bounded = m.trusted, m.bounded
    # Imported test fixture ports only. The installed CLI exposes no overrides.
    m.trusted = lambda path: None
    os.environ.update(GLAMOR_PROC_DIR='/wrong', GLAMOR_MODULE_DIR='/wrong', PYTHONPATH='/wrong')
    result, code = m.observe()
    assert code == 0 and result['processes'] == [{'pid':101,'start':'123'}]
    assert len(json.dumps(result).encode()) <= 8192 and '1000-2000' not in json.dumps(result)
    checks = ['fresh-mappings','environment-ignored','bounded-no-address-receipt']
    for name, value in [('deleted-map',mapping.rstrip()+' (deleted)\n'),('wrong-inode',mapping.replace(str(info.st_ino),str(info.st_ino+1),1)),('wrong-path',mapping.replace(str(m.MODULE),str(m.MODULE)+'-other'))]:
        maps.write_text(value); result, code = m.observe()
        assert code == 1 and result['status'] == 'failed'
        checks.append(name)
    maps.write_text(mapping)
    other = root/'other'; other.write_bytes(b'other')
    (proc/'exe').unlink(); (proc/'exe').symlink_to(other); (proc/'comm').write_text('Xorg\n')
    try:
        m.observe(); raise AssertionError('forged Xorg name accepted')
    except m.Unavailable: checks.append('forged-name-rejected')
    (proc/'exe').unlink(); (proc/'exe').symlink_to(m.XORG)
    for kind in ['unreadable-maps','boot-change','pid-start-change','module-change','mapping-change']:
        original = boot.read_bytes(), start.read_bytes(), m.MODULE.read_bytes()
        def changed(path, limit):
            if path == maps and kind == 'unreadable-maps': raise PermissionError()
            value = real_bounded(path,limit)
            if path == maps:
                if kind == 'boot-change': boot.write_text('00000000-0000-0000-0000-000000000002\n')
                elif kind == 'pid-start-change': start.write_text('101 (Xorg) '+' '.join(['S']+['0']*18+['999']))
                elif kind == 'module-change': m.MODULE.write_bytes(b'changed module')
                elif kind == 'mapping-change': maps.write_text('')
            return value
        m.bounded = changed
        try:
            m.observe(); raise AssertionError(kind+' accepted')
        except (m.Unavailable, PermissionError): checks.append(kind)
        boot.write_bytes(original[0]); start.write_bytes(original[1]); m.MODULE.write_bytes(original[2]); maps.write_text(mapping)
    m.bounded, m.trusted = real_bounded, real_trusted
    try:
        m.trusted(m.MODULE); raise AssertionError('unsafe host parent accepted')
    except m.Unavailable: checks.append('unsafe-host-path')
    print(json.dumps({'checks':checks}))
