#!/usr/bin/env bash
set -euo pipefail

project_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." >/dev/null && pwd -P)
derived_data=$(mktemp -d "${TMPDIR:-/tmp}/open-deskos-management.XXXXXX")
cleanup() {
    rm -rf "$derived_data"
}
trap cleanup EXIT

xcodebuild \
    -project "$project_dir/OpenDeskOS.xcodeproj" \
    -scheme OpenDeskOS \
    -configuration Debug \
    -destination 'platform=macOS' \
    -derivedDataPath "$derived_data" \
    CODE_SIGNING_ALLOWED=NO \
    build >/dev/null

app_path="$derived_data/Build/Products/Debug/OpenDeskOS.app"
cli_path="$app_path/Contents/Resources/OpenDeskOS"

test -x "$cli_path"

check_agent() {
    local name="$1"
    local interval="$2"
    local plist="$app_path/Contents/Library/LaunchAgents/$name"

    test -f "$plist"
    plutil -lint "$plist" >/dev/null
    test "$(/usr/libexec/PlistBuddy -c 'Print :BundleProgram' "$plist")" = 'Contents/Resources/OpenDeskOS'
    test "$(/usr/libexec/PlistBuddy -c 'Print :StartInterval' "$plist")" = "$interval"
    test "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' "$plist")" = 'plugin'
    test "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:2' "$plist")" = 'health'
    test "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:3' "$plist")" = '--daemon'
    test "$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:FLOW_API_PORT' "$plist")" = '8787'
    if /usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:FLOW_API_TOKEN' "$plist" >/dev/null 2>&1; then
        print -u2 "managed LaunchAgent must not embed FLOW_API_TOKEN: $name"
        exit 1
    fi
}

check_agent 'dev.fradser.open-deskos.wispr-health.app.5m.plist' 300
check_agent 'dev.fradser.open-deskos.wispr-health.app.15m.plist' 900
check_agent 'dev.fradser.open-deskos.wispr-health.app.30m.plist' 1800
check_agent 'dev.fradser.open-deskos.wispr-health.app.60m.plist' 3600

rg -q 'WisprFlowManagementView' "$project_dir/OpenDeskOS/ContentView.swift"
rg -q 'BackgroundHealthManagementView' "$project_dir/OpenDeskOS/ContentView.swift"
rg -q 'BackgroundHealthAgentManager' "$project_dir/OpenDeskOS/Management/BackgroundHealthAgentManager.swift"
rg -q 'signed, installed copy of OpenDeskOS' "$project_dir/OpenDeskOS/ContentView.swift"
rg -q 'startWisprFlowAfterSessionChange' "$project_dir/OpenDeskOS/Plugins/PluginHost.swift"
rg -Fq 'healthCheckTask?.cancel()' "$project_dir/OpenDeskOS/Plugins/PluginHost.swift"
rg -q 'generation == self.healthCheckGeneration' "$project_dir/OpenDeskOS/Plugins/PluginHost.swift"
rg -q 'canManageConfiguredEndpoint' "$project_dir/OpenDeskOS/Management/BackgroundHealthAgentManager.swift"
rg -q 'standaloneInstallCommand' "$project_dir/OpenDeskOS/Management/BackgroundHealthAgentManager.swift"

enable_implementation=$(sed -n '/    func enable()/,/    func disable()/p' "$project_dir/OpenDeskOS/Management/BackgroundHealthAgentManager.swift")
printf '%s\n' "$enable_implementation" | rg -Fq 'try await self.unregisterSchedules(except: nil)'
printf '%s\n' "$enable_implementation" | rg -Fq 'try self.service(for: schedule).register()'
if printf '%s\n' "$enable_implementation" | rg -Fq 'selectedService.status == .notRegistered'; then
    print -u2 'enabling a selected schedule must refresh an already registered LaunchAgent'
    exit 1
fi

rg -Fq 'deactivateManagedChecksForIncompatibleEndpoint()' "$project_dir/OpenDeskOS/Management/BackgroundHealthAgentManager.swift"
incompatible_endpoint_implementation=$(sed -n '/    private func deactivateManagedChecksForIncompatibleEndpoint()/,/    func enable()/p' "$project_dir/OpenDeskOS/Management/BackgroundHealthAgentManager.swift")
printf '%s\n' "$incompatible_endpoint_implementation" | rg -Fq 'try await self.unregisterSchedules(except: nil)'

printf 'macOS management console acceptance checks passed\n'
