"""Verify the consolidated documentation paths without a target build.

Given one domain owner and no module README or library Markdown,
when the documentation plans run,
then the old output names contain only their own complete sections.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[3] / 'components/common/lua_module_builder/tools'
sys.path.insert(0, str(TOOLS))
from lua_sync_common import ComponentSource, FileSyncPlan, LuaSyncError
from sync_lua_module_docs import collect_lua_module_docs
from sync_lua_module_resources import collect_builtin_lua_module_libs
from generate_builtin_modules_skill import collect_lua_module_skill_entries, render_generated_skill


class LuaDocOwnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.modules = self.root / 'lua_modules'
        self.module = self.modules / 'lua_driver_i2c'
        (self.module / 'lib').mkdir(parents=True)
        (self.module / 'lib/ssd1306.lua').write_text('return {}\n')
        self.owner = self.modules / 'lua_module_system/README.md'
        self.owner.parent.mkdir(parents=True)
        self.module_text = '# I2C\n\nread(dev, size) returns bytes or an error.\n'
        self.lib_text = '# SSD1306\n\nclose() releases the device.\n'
        self.owner.write_text(
            '# Domain API\n\n'
            '<!-- doc: lua_driver_i2c/README.md -->\n' + self.module_text +
            '\n<!-- doc: lua_driver_i2c/lib/ssd1306.md -->\n' + self.lib_text
        )
        self.source = ComponentSource('lua_driver_i2c', self.module)

    def test_module_output_and_generated_skill_keep_old_name(self) -> None:
        out = self.root / 'docs'
        plan = collect_lua_module_docs([self.source], out, self.root / 'docs.json')
        plan.apply()
        self.assertEqual((out / 'lua_driver_i2c.md').read_text(), self.module_text)
        self.assertEqual(plan.input_paths, [self.owner.resolve()])
        skill = render_generated_skill(collect_lua_module_skill_entries([self.source]))
        self.assertIn('`lua_driver_i2c.md`', skill)

    def test_library_output_keeps_script_and_doc_name(self) -> None:
        out = self.root / 'builtin'
        plan = collect_builtin_lua_module_libs([self.source], out, self.root / 'libs.json')
        plan.apply()
        self.assertEqual((out / 'lib/ssd1306.lua').read_text(), 'return {}\n')
        self.assertEqual((out / 'lib/ssd1306.md').read_text(), self.lib_text)

    def test_missing_section_fails(self) -> None:
        self.owner.write_text('# Domain API\n')
        with self.assertRaises(LuaSyncError):
            plan = collect_lua_module_docs([self.source], self.root / 'docs', self.root / 'docs.json')
            plan.apply()

    def test_missing_section_preserves_previous_output(self) -> None:
        import json
        out = self.root / 'docs'
        out.mkdir()
        old = out / 'old.md'
        old.write_text('# Previous documentation\n')
        manifest = self.root / 'docs.json'
        manifest.write_text(json.dumps({'synced_files': ['old.md']}))
        self.owner.write_text('# Missing section\n')
        with self.assertRaises(LuaSyncError):
            collect_lua_module_docs([self.source], out, manifest).apply()
        self.assertEqual(old.read_text(), '# Previous documentation\n')

    def test_unmapped_component_still_uses_its_readme(self) -> None:
        unknown = self.modules / 'lua_module_external'
        unknown.mkdir()
        readme = unknown / 'README.md'
        readme.write_text('# External\n')
        out = self.root / 'external'
        plan = collect_lua_module_docs([ComponentSource(unknown.name, unknown)], out, self.root / 'external.json')
        plan.apply()
        self.assertEqual((out / 'lua_module_external.md').read_text(), '# External\n')

    def test_non_document_copy_is_unchanged(self) -> None:
        src = self.root / 'raw.bin'
        src.write_bytes(bytes(range(256)))
        plan = FileSyncPlan(self.root / 'out', self.root / 'raw.json')
        plan.add('raw.bin', src, 'fixture')
        plan.apply()
        self.assertEqual((self.root / 'out/raw.bin').read_bytes(), src.read_bytes())


if __name__ == '__main__':
    unittest.main()
