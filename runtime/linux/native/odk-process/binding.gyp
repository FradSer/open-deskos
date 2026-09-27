{
  "variables": {
    "win_delay_load_hook": "true"
  },
  "targets": [
    {
      "target_name": "odk_process",
      "win_delay_load_hook": "true",
      "sources": ["src/odk_process.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17"]
        }
      }
    }
  ]
}