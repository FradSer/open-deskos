# Native peripheral plugin host

[odk_plugin_host.c](odk_plugin_host.c) owns synchronous lifecycle operations for trusted C plugins.
The host allocates no heap memory.
One owner task calls its lifecycle operations.
Descriptors, configuration pointers, and the host must remain valid throughout their lifecycle.
Do not initialize a host again while it owns resources.

The host supports 16 plugins and eight provided ports per plugin.
Port matching uses exact interface strings.
Validation rejects duplicate identities, duplicate providers, missing required dependencies, and cycles before initialization.
Optional dependencies participate in startup order and replacement.
A failed factory does not prevent independent plugins from starting.
Required consumers remain blocked when their provider is unavailable.

Each plugin publishes every declared port during initialization.
Consumers can read only their declared dependencies.
The composition root can read running ports through `odk_plugin_host_port()`.
Native code remains trusted.
Port declarations do not provide a sandbox or authorize third-party loading.

Shutdown stops consumers before providers.
Failed stop prevents destructive cleanup for that component.
Failed cleanup retains resource ownership and prevents initialization over those resources.
A retained consumer prevents provider cleanup.
Independent components can still stop.
Repeated shutdown retries incomplete phases.
Successful cleanup phases do not run again.
Only a cleanup callback can read a retained dependency that is no longer publicly available.

[codegen_plugin_descriptor.py](../../tools/codegen_plugin_descriptor.py) generates immutable descriptors from local manifests.
The optional `lifecycle` field names an explicitly linked native C symbol.
The generator rejects invalid symbols before it writes output.
Unbound descriptors remain data and cannot start through this host.

[Scenarios](tests/plugin-host.feature) define the lifecycle contract.
The host fixture compiles with warnings treated as errors.
It checks dependency order, disable operations, partial initialization, cleanup retries, and replacement buffer ports.
Source wiring checks supplement the fixture and target compilation.
They do not prove device behavior.

## Local lifecycle snapshots

`odk_plugin_host_snapshot()` reads the current owned host without executing driver callbacks or allocating heap memory.
Call it from the owner task between lifecycle operations.
The API rejects a host during a lifecycle transition.
It does not provide synchronization between tasks.

Supply a caller-owned `odk_plugin_snapshot_t` array and its capacity.
The snapshot contains identity, name, version, kind, state, enabled selection, resource ownership, and completed stop and destroy phases.
It excludes configuration, resource, and lifecycle pointers.
Identity and name borrow immutable descriptor strings and require the descriptor lifetime.
Other fields are copies; editing them does not change host state.

Insufficient capacity returns `ESP_ERR_NO_MEM`, reports the required count, and leaves all output rows unchanged.
Pass NULL rows with zero capacity to query the required count.
Other failures report zero count and leave rows unchanged.
A successful read writes exactly the reported number of rows, up to 16.

Failed states can remain after cleanup completes.
Resource ownership and cleanup phases distinguish retained resources from completed cleanup without changing lifecycle semantics.
These snapshots do not certify driver health or provide a firmware operator channel.
The [diagnosis fixture](tests/plugin_diagnosis_test.c) checks actual startup, disable, failed stop, retained providers, and cleanup retry.

## Generated runtime reports

`odk_plugin_host_report_json()` serializes the current composition into a caller-owned JSON buffer without driver callbacks or heap allocation.
Use the same owner task and operation boundaries as lifecycle snapshots.
Pass `esp32-s3` or `esp32-p4` as the host identity.
The instance field uses that host identity; a transport must identify each physical endpoint separately.

The generator stores public manifest JSON and host metadata in each descriptor.
Reports preserve source semantic versions, ports, optional dependencies, and permission names.
The existing numeric descriptor version remains unchanged.
Public metadata excludes other manifest and port fields.
The serializer trusts immutable generated metadata; the Shell validator checks report declarations before accepting them.
Descriptors without report metadata return `ESP_ERR_NOT_FOUND` without changing their lifecycle support.

The report contains current lifecycle states, enabled selection, and unknown health.
It does not certify driver or hardware health.
Serialization requires at most 16 KiB of report bytes and a fixed snapshot array.
Output capacity must include the terminating NUL byte.
Returned size excludes that byte.
Pass NULL output with zero capacity to query size.
Insufficient capacity reports the required byte size without writing output.
An oversized report returns `ESP_ERR_NO_MEM` with zero size and leaves output unchanged.
Other failures also return zero size without writing output.

The [runtime report tests](tests/test_runtime_report.py) generate and compile actual S3/P4 manifests and pass reports through the actual Shell validator.
These checks do not provide a firmware operator transport or physical-device acceptance.
