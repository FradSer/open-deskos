"""Generated native reports must pass the actual Shell runtime validator."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
COMMON = ROOT / "peripherals/common"


@pytest.mark.parametrize("platform", ("esp32-s3", "esp32-p4"))
def test_generated_native_report_matches_shell_contract(tmp_path, platform):
    directory = ROOT / "peripherals" / ("esp32-s3-remote" if platform == "esp32-s3" else "esp32-p4-camera") / "main/plugins"
    declarations = [json.loads(path.read_text()) for path in sorted(directory.glob("*.json"))]
    declarations[0].update(version="2.3.4", name='Fixture "panel"\n\u6d4b\u8bd5', permissions=["usb"], privateConfig="private-fixture-value")
    declarations[0]["provides"][0]["privateConfig"] = "private-port-value"
    if declarations[0].get("requires"):
        declarations[0]["requires"][0]["optional"] = True
    paths = []
    for index, manifest in enumerate(declarations):
        path = tmp_path / f"manifest-{index}.json"
        path.write_text(json.dumps(manifest))
        paths.append(str(path))
    subprocess.run([sys.executable, str(ROOT / "tools/codegen_plugin_descriptor.py"), str(tmp_path / "generated.h"),
                    str(tmp_path / "generated.c"), *paths], check=True, capture_output=True)
    (tmp_path / "esp_err.h").write_text('''#pragma once
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_NO_MEM 0x101
''')
    bindings = "\n".join(f'const odk_plugin_lifecycle_t {item["lifecycle"]} = {{.init=init}};' for item in declarations)
    (tmp_path / "fixture.c").write_text('''#include "generated.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static int operations;
static int value;
static esp_err_t init(void *opaque, const void *config) {
    (void)config;
    odk_plugin_context_t *context = opaque;
    const odk_plugin_descriptor_t *descriptor = &context->host->descriptors[context->index];
    ++operations;
    for (size_t p = 0; p < descriptor->provides_count; ++p)
        assert(odk_plugin_publish(context, descriptor->provides[p].interface_uri, &value) == ESP_OK);
    return ESP_OK;
}
''' + bindings + '''
int main(void) {
    odk_plugin_host_t host;
    static char output[16385];
    size_t size = 0;
    assert(odk_plugin_host_init(&host, g_odk_plugins, g_odk_plugins_count, NULL) == ESP_OK);
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, sizeof(output), &size) == ESP_OK);
    assert(operations == 0);
    puts(output);
    char before[sizeof(output)];
    memcpy(before, output, sizeof(output));
    size_t required = size;
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, 1, &size) == ESP_ERR_NO_MEM);
    assert(size == required && memcmp(before, output, sizeof(output)) == 0);
    assert(odk_plugin_host_start(&host) == ESP_OK);
    int previous = operations;
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, sizeof(output), &size) == ESP_OK);
    assert(operations == previous);
    puts(output);
    assert(odk_plugin_host_stop(&host) == ESP_OK);
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, sizeof(output), &size) == ESP_OK);
    puts(output);
    memcpy(before, output, sizeof(output));
    required = size;
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", NULL, 0, &size) == ESP_ERR_NO_MEM);
    assert(size == required);
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, required, &size) == ESP_ERR_NO_MEM);
    assert(size == required && memcmp(before, output, sizeof(output)) == 0);
    assert(odk_plugin_host_report_json(&host, "unsupported", output, sizeof(output), &size) == ESP_ERR_INVALID_ARG);
    assert(size == 0 && memcmp(before, output, sizeof(output)) == 0);
    host.transition = true;
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, sizeof(output), &size) == ESP_ERR_INVALID_STATE);
    assert(size == 0 && memcmp(before, output, sizeof(output)) == 0);
    host.transition = false;
    host.records[0].state = (odk_plugin_state_t)99;
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, sizeof(output), &size) == ESP_ERR_INVALID_ARG);
    assert(size == 0 && memcmp(before, output, sizeof(output)) == 0);
    host.records[0].state = ODK_PLUGIN_STOPPED;
    odk_plugin_descriptor_t altered[ODK_PLUGIN_MAX_COUNT];
    memcpy(altered, g_odk_plugins, g_odk_plugins_count * sizeof(*altered));
    host.descriptors = altered;
    altered[0].manifest_json = NULL;
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, sizeof(output), &size) == ESP_ERR_NOT_FOUND);
    assert(size == 0 && memcmp(before, output, sizeof(output)) == 0);
    static char oversized[16385];
    memset(oversized, ' ', sizeof(oversized) - 1);
    altered[0].manifest_json = oversized;
    assert(odk_plugin_host_report_json(&host, "''' + platform + '''", output, sizeof(output), &size) == ESP_ERR_NO_MEM);
    assert(size == 0 && memcmp(before, output, sizeof(output)) == 0);
    return 0;
}
''')
    compiler = shutil.which("cc")
    assert compiler, "Host C compiler required"
    subprocess.run([compiler, "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", str(tmp_path), "-I", str(COMMON),
                    str(COMMON / "odk_plugin_host.c"), str(tmp_path / "generated.c"), str(tmp_path / "fixture.c"),
                    "-o", str(tmp_path / "report")], capture_output=True, check=True)
    native = subprocess.run([str(tmp_path / "report")], capture_output=True, text=True, check=True)
    reports = [json.loads(line) for line in native.stdout.splitlines()]
    assert "private-fixture-value" not in native.stdout
    assert "private-port-value" not in native.stdout
    validator = ROOT / "runtime/shell/src/plugin-runtime-report.js"
    code = "const fs=require('node:fs');const {sanitizeRuntimePlugins}=require(process.argv[1]);const reports=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(reports.map(report=>sanitizeRuntimePlugins(report,process.argv[2]))));"
    normalized = subprocess.run(["node", "-e", code, str(validator), platform], input=json.dumps(reports),
                                text=True, capture_output=True, check=True)
    for items, state in zip(json.loads(normalized.stdout), ("registered", "running", "stopped"), strict=True):
        assert len(items) == len(declarations)
        for item, source in zip(items, declarations, strict=True):
            expected = {field: source[field] for field in ("schemaVersion", "id", "name", "version", "host", "kind")}
            expected.update(permissions=source.get("permissions", []))
            for field in ("provides", "requires"):
                expected[field] = [{key: value for key, value in port.items() if key in ("interface", "optional")}
                                   for port in source.get(field, [])]
            assert item["manifest"] == expected
            assert item["state"] == state and item["enabled"] is True
            assert item["health"] == {"state": "unknown", "reason": "not-declared"}
