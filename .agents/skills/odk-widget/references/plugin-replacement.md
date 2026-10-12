# Plugin replacement and preserved behavior

Read this for plugin extraction, replacement, or compatibility claims that affect a Widget or App.
This guide defines development gates, not new runtime contracts.
Read @PRODUCT.md for scope.
Read @runtime/shell/docs/ARCHITECTURE.md for kernel and plugin boundaries.
Read @runtime/shell/docs/PLUGIN_COVERAGE.md for implementation evidence and remaining work.
These repository documents require a source checkout; packaged skill checks cannot certify their availability.

## Choose the acceptance gap first

Read the feature matrix before choosing replacement work.
Name the feature, missing operation, public consumer, and evidence needed to close that gap.
Use these decisions before extending a common mechanism:

| Current evidence | Next action |
| --- | --- |
| The mechanism works, but a feature has no independent implementation | Apply the existing mechanism to that feature's behavior scenarios. |
| A concrete feature path fails at a shared boundary | Reproduce that failure before changing the shared mechanism. |
| A check fails without enough phase evidence | Add bounded observation and retain the unresolved acceptance status. |
| Local replacement works, but supported-host evidence is missing | Report the host gap and follow operational authorization requirements. |

Diagnostic progress does not close the feature gap that required diagnosis.
Keep detailed completion rules in the recovery section below.

## 1. Define ownership and compatibility

Identify the feature owner before moving code.
Record its public inputs, outputs, persisted data, dependencies, resources, and consumers.
Trace the production caller to that owner before assigning a feature to a plugin identity.
Separate built-in App views, installed package composition, and package runtime ownership where their paths differ.
Reconcile the feature matrix with those paths; filenames and directory placement alone do not establish ownership.
Keep startup, authorization, direct input, Back, and recovery under the documented kernel authority.
Use existing public contracts before adding a capability or abstraction.
Keep provider requests and credentials outside renderer plugins.

Write shared Given/When/Then scenarios for the default implementation and replacement.
Include values, provenance, units, state transitions, cache behavior, navigation, and resource release where applicable.
Treat package declarations as interface checks only.
Do not infer behavior compatibility from an accepted manifest or matching port names.

Use the default implementation as the behavior baseline.
Classify discovered defects as introduced, pre-existing, or unresolved.
Document an authorized defect repair separately from compatibility evidence.
Update its acceptance scenario before implementation.
Do not silently redefine the baseline to make a replacement pass.

### Define state transfer before replacement

Identify which state must survive replacement and which state resets during ordinary disable and enable.
Include foreground selection, removed catalog entries, user preferences, and persisted data when the feature owns them.
Keep state transfer under the documented owner; do not infer migration support from matching methods.
For supported transfer, verify snapshot isolation, validation before publication, and restoration before consumers receive the replacement.
Test failed startup and failed cleanup with the same retained state and explicit retry ownership.
Record legacy implementations without transfer support as a compatibility limit.
Do not silently add migration requirements to their existing contract.

## 2. Prove the selected implementation executes

Exercise the actual loader, Host composition, public consumer, and required installation path.
Distinguish a development link from a signed installed revision.
Verify the executed implementation, not only the selected manifest.
Make unintended default construction fail in an isolated replacement fixture where possible.

An independent replacement must own the behavior under test without calling the default factory.
List shared projection modules, provider libraries, and helpers explicitly.
Shared code does not prove an alternative algorithm or provider.
Do not expand a copied-factory result into an independent implementation claim.

Classify each shared dependency before claiming independence:

| Dependency | Required decision |
| --- | --- |
| Public Host service, token, or placement contract | Identify its documented owner and supported plugin interface. |
| Default feature algorithm, private helper, or mutable definition | Treat it as coupling that limits the replacement claim. |
| Static markup, stylesheet, font, or provider library | State the shared behavior and the independence that remains unverified. |

Shared dependencies can be deliberate product contracts.
Do not duplicate them merely to make an implementation appear independent.
For third-party implementation claims, check that required contracts are available without importing private default implementation code.
Do not broaden algorithm replacement evidence into stylesheet, provider, or navigation replacement evidence.

Identify which composition boundaries the fixture controls or replaces.
A fixture that uses actual preload or CLI can still bypass production startup and consumer wiring.
For production integration claims, exercise the production composition and all affected consumer contexts together.
Separate Shell document results from installed-package document results when configuration crosses their isolation boundary.

When acceptance crosses a verifier or policy boundary, retain its actual bounded verdict before asserting the public result.
Observe the real implementation without changing its inputs, result, authority, or deadline.
Include a controlled rejection through the same path.
Verify the public failure response, retained installed state, unaffected consumers, and normal resource release.
Exclude package contents, credentials, and unrestricted subprocess output from diagnostics.
A controlled rejection validates observation; it does not explain an earlier failure without recorded evidence.

Read @runtime/shell/docs/NATIVE_PLUGINS.md when the replacement requires trusted native loading.
Keep signature verification, publisher policy, operator trust, and capability grants as separate checks.
Native signatures and declared grants do not provide a sandbox.
Preserve the separate authority limits of installed HTML packages.

### Validate the replacement fixture

Use controlled invalid candidates when acceptance depends on fixture guards or comparison rules.
Run them through the same loader, context adaptation, and public consumer as ordinary candidates.
Confirm rejection at the intended boundary and verify that the running implementation retains ownership.
A setup failure or unrelated rejection does not validate the guard.
Check each claimed loading mode when its adaptation or authority differs.
Keep these controls isolated; do not weaken production policy to create a passing fixture.

When comparing implementations, also assert the applicable product requirement independently.
Check policy-sensitive effects in the rendered consumer, including styles, focus, and permitted actions.
Matching DOM attributes alone cannot prove that browser policy permits their effect.
Record shared defects separately from replacement regressions.
Preserve the compatibility baseline until an authorized repair changes its behavior scenario.

## 3. Follow the consumer through difficult states

Compare both implementations through the same public consumer scenarios.
Keep comparison inputs equal, including time, selected data, and settled fonts.
When inputs differ, repeat the comparison with controlled inputs before changing rendering tolerances.
Use actual preload and rendered consumers when the claim includes the interface.
Check long English and CJK content, supported themes, compact sizes, and wide sizes.
Measure positive element dimensions and containment on both axes.
Verify that overflow content has a usable path to its final character.
Keep text above the product minimum size.

For decoded images, compare distinct image regions and aspect ratio.
A nonempty canvas does not prove correct image content.
For keyboard behavior, use browser input dispatch and check focus, scrolling, and page ownership.
Programmatic scroll assignment and synthetic DOM events prove narrower behavior.
Report these evidence levels separately from physical input acceptance.

## 4. Verify lifecycle and report limits

Check disable, enable, failed cleanup, retry, cancellation, and independent consumer availability where applicable.
Wait for owned work to finish before starting another implementation.
Verify that late responses cannot change released state or persisted data.

Track resources returned by a factory before validating the rest of their public interface.
A rejected result can still own resources; retain its available cleanup path until release succeeds.
Test malformed results that provide cleanup, including failed release and explicit retry.
When no cleanup path exists, report the ownership gap rather than treating interface rejection as completed release.

For subscribed surfaces, capture callbacks before release and invoke them after the same container mounts again.
Check former nodes and the new placement; verify that current callbacks still update the active surface.
Repeat with a failed unsubscribe and its supported cleanup retry.
Separate permission to update from ownership of resources that still need cleanup.
A retained subscription can remain owned without retaining permission to mutate a released placement.
An unsubscribe call alone does not prove that already captured callbacks are harmless.

Install resource observations before the first acquisition when claiming complete lifecycle coverage.
Confirm that the initial mounted consumer appears in those observations before replacement starts.
Check acquisition, failed release, retry, and final release against the actual resource owner.
A zero counter cannot prove cleanup when earlier acquisitions were outside its observation period.
Verify the observation mechanism through the real loading path, even when its isolated checks pass.

Separate operation cancellation from the selected factory's later lifecycle.
Forward cancellation through discovery, construction, and startup for the initiating operation.
Do not retain an expired operation signal in definitions used by later enable, rollback, or restart.
Test cancellation before construction, during startup, and while the previous implementation releases resources.
Include a concurrent disable request where supported.
Then verify the retained definition and a later enable or recovery operation through the public interface.
Cancellation must leave a defined owner even when candidate construction never starts.

When input identity changes during a request, test both response orders through the public consumer.
Include account, location, document, or selected resource changes where applicable.
Bind each result and cache entry to the inputs that started its request.
Do not combine an earlier result with the current selection's label or authorization context.
Use controlled request completion rather than timing delays for these scenarios.

Keep startup selection, runtime enable operations, and runtime replacement claims separate.
For runtime replacement or recovery claims, apply the operation gates below.

Exercise update, rollback, removal, and process restart when the compatibility claim includes those operations.
Check retained data, stored revisions, configuration, and unaffected peers.
Do not substitute an in-process Host restart for an Electron process restart.

Follow [verification](verification.md) for isolated execution and applicable shared gates.
Report declaration, execution, source, rendered, lifecycle, live-provider, and device evidence separately.
A new failing gate leaves its acceptance claim unresolved.
Earlier passing suites do not certify the changed candidate.
Report Windows, macOS, and CM5 results separately.
Keep physical peripheral acceptance and operational authorization separate from local fixture results.

## 5. Close the operator path

Read @runtime/shell/docs/RUNTIME_PLUGIN_REPLACEMENT.md before changing runtime activation or recovery.
Identify the supported operation for each affected runtime and implementation type.
Record unsupported operations explicitly.
A common factory interface does not establish common management support.

Trace each claimed operation through these boundaries:

| Boundary | Required evidence |
| --- | --- |
| Discovery and routing | One current runtime owns the requested identity; ambiguous ownership refuses mutation. |
| Authorization and capture | The owning Host validates current policy and captures the exact implementation before release. |
| Loading and selection | The actual consumer executes the captured implementation in the claimed process or document. |
| Completion | The receipt identifies the selected implementation and follows completed lifecycle work. |
| Recovery | Failed startup, failed cleanup, cancellation, and unavailable configuration have explicit outcomes. |

Keep saved selection, captured revision, running implementation, lifecycle state, and feature health distinct.
Bind asynchronous results to their initiating selection and runtime authority.
Test selection changes, navigation, shutdown, and timeout during preparation and execution where applicable.
An uncertain mutation outcome requires reconciliation through existing observation paths before another mutation.
Do not infer failure or retry safety from a lost receipt.
Separate the public request lifetime from the underlying implementation operation.
A timeout can end the request while preparation or dispatched work still owns resources.
Require validated settlement from the initiating authority before releasing an uncertain operation's slot.
Test late completion, foreign reports, duplicate reports, and frame changes without automatic replay.

Verify browser asset authority before document loading when later publication must work without navigation.
Record who retains each captured revision and when its resources can be released.
Test repeated replacement against declared resource limits.
Retained immutable captures alone do not prove bounded operation over time.

For cached captures, verify current authorization and signed bytes before reuse.
A matching identity and revision cannot establish current permission or byte integrity.
Test revocation and changed stored bytes after a successful cache hit.

For resource retirement, identify each owner and its release evidence:

| Owner | Required release evidence |
| --- | --- |
| Running factory and mounted consumers | Owned cleanup has completed, including dependent surfaces. |
| Candidate awaiting activation | Loading and execution have settled; cancellation alone does not establish release. |
| Retained public definition or factory | Supported later reuse preserves its resources until that reference's ownership ends. |
| Queued programmatic operation | The queue no longer retains or can execute the captured definition. |
| Failed cleanup or uncertain operation | Reconciliation identifies retained owners before retirement. |
| Discovery entry or capture cache | References are removed or refreshed before a later load can reuse them. |
| Independent asset snapshot | Its documented lifetime remains valid after another owner releases the revision. |

Use the actual ownership contract to decide which rows apply.
Trace every supported mutation path, including direct programmatic calls outside authenticated management.
Test retaining an old definition, selecting another revision, then reusing the old definition with lazy assets.
Preserve supported reuse unless the user explicitly authorizes a contract change.
Do not release resources from a generic failure receipt or a newer saved selection alone.
Test repeated distinct revisions, rollback, failed cleanup, and uncertain completion against the same resource limits.
Same-revision reuse does not prove bounded retention across revisions.

Keep resource accounting under the same authority as resource ownership.
When a live view creates a snapshot, calculate its retained resources at snapshot creation.
Test snapshots created before publication and after retirement against the byte and entry limits.
Verify that retirement returns capacity to the publisher while independent snapshots retain their documented resources.

## 6. Treat recovery as a separate contract

Define recovery prerequisites independently from installation and activation prerequisites.
When built-in recovery must survive invalid external configuration, test malformed configuration and revoked publisher trust.
Recovery cannot depend on the failed external implementation when the product contract requires independent recovery.
Preserve saved selections unless the operation explicitly includes a configuration change.

Include manual refresh and fallback retries in the shutdown owner's operation tracking.
When shutdown starts, refuse new recovery work and prevent pending recovery from constructing, publishing, or mounting another implementation.
Recheck operation authority after asynchronous cleanup and startup boundaries.
Shutdown must await pending recovery and release any resources it acquired before shutdown began.
Test shutdown during gated recovery cleanup and startup; assert final resource ownership and absence of later mounts.
Use controlled completion gates rather than elapsed-time assumptions.

Define what the recovery baseline includes before implementation.
Separate the factory implementation from configured declarations, user preferences, and persisted data.
Identify consumers that receive configuration through another process or document.
For factory recovery, verify that those consumers retain the same configuration and behavior.
For configuration reset, define how all affected consumers receive the new configuration.
Do not infer a configuration reset from the command name or a built-in version receipt.

Capture the recovery baseline before external code can change its definitions.
Preserve the required manifests, factories, lifecycle functions, and resource bindings under the recovery owner's authority.
Test later definition mutation and verify the restored implementation through that authority.
A matching version label alone does not prove restoration.
List resource-binding restrictions that can prevent recovery, including incompatible stylesheets where applicable.

Test recovery with supported differences in dependencies and provided ports.
Validate the complete candidate graph before releasing the running graph.
Recalculate affected consumers when queued operations execute after graph changes.
Keep ordinary replacement restrictions separate from explicitly authorized recovery recomposition.
Do not broaden replacement permissions merely to make recovery pass.

Use one feature's complete path to establish a reusable verification method.
Apply that method to each remaining feature and runtime before claiming system completion.
Keep feature status in @runtime/shell/docs/PLUGIN_FEATURE_MATRIX.md and measured evidence in @runtime/shell/docs/PLUGIN_COVERAGE.md.
Do not copy historical run results into this skill.

Before extending common infrastructure, identify the feature acceptance gap that the change closes.
Choose the smallest complete path through implementation, public consumer, management, and recovery for that gap.
Record infrastructure progress separately from feature completion.
After proving a common mechanism, apply it to remaining feature owners rather than treating repeated mechanism tests as broader coverage.
