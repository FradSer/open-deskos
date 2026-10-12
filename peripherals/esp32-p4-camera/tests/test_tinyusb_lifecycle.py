"""Reviewed TinyUSB worker and driver cleanup retain retry ownership."""
from pathlib import Path
import importlib.util
import shutil
import subprocess
import pytest

ROOT=Path(__file__).resolve().parents[3]
SCRIPT=ROOT/'tools/extend_tinyusb_lifecycle.py'
MANAGED=ROOT/'peripherals/esp32-p4-camera/managed_components'
WRAPPER=MANAGED/'espressif__esp_tinyusb'
CORE=MANAGED/'espressif__tinyusb/src/device'


def module():
    spec=importlib.util.spec_from_file_location('extend_tinyusb_lifecycle',SCRIPT)
    extension=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extension)
    return extension


def generated(tmp_path):
    if not WRAPPER.is_dir() or not CORE.is_dir(): pytest.skip('Install the P4 managed dependencies first')
    extension=module()
    original={name: ((CORE if name=='usbd.c' else WRAPPER)/name).read_bytes() for name in extension.REVIEWED}
    extension.generate(WRAPPER,CORE,tmp_path)
    assert original=={name: ((CORE if name=='usbd.c' else WRAPPER)/name).read_bytes() for name in extension.REVIEWED}
    return extension,(tmp_path/'odk_tinyusb_task.c').read_text()


def function(source,name):
    # Reviewed SDK functions close at column zero. Conditional branches can
    # contain alternative opening braces, so raw brace counting is insufficient.
    marker=source.index('esp_err_t '+name+'(') if name.startswith('tinyusb_driver_') else source.index(name+'(')
    start=source.rfind('\n',0,marker)+1
    end=source.index('\n}',start)+2
    return source[start:end]


def compile_run(tmp_path,fixture):
    compiler=shutil.which('cc'); assert compiler is not None,'Host C compiler required'
    source=tmp_path/'fixture.c'; source.write_text(fixture)
    binary=tmp_path/'fixture'
    built=subprocess.run([compiler,'-std=c11','-Wall','-Wextra','-Werror','-Wno-unused-parameter',str(source),'-o',str(binary)],capture_output=True,text=True)
    assert built.returncode==0,built.stderr
    result=subprocess.run([str(binary)],capture_output=True,text=True)
    assert result.returncode==0,result.stderr


def test_unknown_revision_fails_before_writing_sources(tmp_path):
    extension=module(); source=tmp_path/'source'; source.mkdir()
    for name in extension.REVIEWED: (source/name).write_text('unreviewed')
    output=tmp_path/'output'
    with pytest.raises(ValueError,match='reviewed'): extension.generate(source,source,output)
    assert not output.exists()


def task_fixture(extension, source):
    context_start=source.index('typedef struct {'); context_end=source.index('} tinyusb_task_ctx_t;',context_start)+len('} tinyusb_task_ctx_t;')
    state='\n'.join(line for line in extension.STATE.splitlines() if not line.startswith('#include'))
    fixture=Path(__file__).with_name('tinyusb_lifecycle_test.c').read_text()
    fixture=fixture.replace('/* GENERATED_CONTEXT */',source[context_start:context_end]).replace('/* GENERATED_STATE */',state)
    fixture=fixture.replace('/* GENERATED_FUNCTIONS */','\n'.join(function(source,name) for name in ('tinyusb_device_task','tinyusb_task_start','tinyusb_task_stop')))
    return fixture


def test_generated_task_lifecycle_waits_and_retries(tmp_path):
    extension,source=generated(tmp_path)
    compile_run(tmp_path,task_fixture(extension,source))
    core=(tmp_path/'odk_usbd.c').read_text()
    assert 'while (!p4_tinyusb_stopping()) {' in function(core,'tud_task_ext')
    assert 'vTaskDelete(task_ctx->handle)' not in source


def test_generated_driver_retains_phy_until_cleanup_succeeds(tmp_path):
    extension,source=generated(tmp_path)
    (tmp_path/'task_fixture.c').write_text(task_fixture(extension,source))
    driver=(tmp_path/'odk_tinyusb.c').read_text()
    context_start=driver.index('typedef struct {')
    context_end=driver.index('} tinyusb_ctx_t;',context_start)+len('} tinyusb_ctx_t;')
    fixture=Path(__file__).with_name('tinyusb_driver_test.c').read_text()
    fixture=fixture.replace('/* GENERATED_DRIVER_CONTEXT */',driver[context_start:context_end])
    fixture=fixture.replace('/* GENERATED_DRIVER_FUNCTIONS */','\n'.join(function(driver,name) for name in ('tinyusb_driver_install','tinyusb_driver_uninstall')))
    compile_run(tmp_path,fixture)
