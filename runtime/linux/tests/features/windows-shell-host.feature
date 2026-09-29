Feature: 64-bit Windows as a Shell Host

  A Shell Host supplies process inspection, state locations, endpoint naming, and the
  Pi executable-name rule. The Display Shell itself does not change per host, and a host
  never changes what the desk states as true.

  Scenario: A Windows host starts the same Display Shell without bash
    Given a 64-bit Windows machine with the runtime dependencies installed
    When the operator starts the shell
    Then the five desktop pages are reachable at the configured content size
    And no bash interpreter is required to start or verify it

  Scenario: Host facts resolve the Shell Host
    Given the runtime resolves the Shell Host from host facts
    When the platform is win32 and the architecture is x64
    Then the resolved host reports the Windows x64 host
    And the reference host stays the Linux arm64 host
    And a host outside the supported set is reported as unsupported

  Scenario: Persistent state follows the host convention
    Given the runtime resolves its persistent state directory
    When the Shell Host is Windows
    Then the directory lies under the user's Windows local application data root
    And a Unix host keeps its existing state location

  Scenario: A logical link name maps to its host endpoint
    Given the runtime resolves the endpoint of a logical link name
    When the Shell Host is Windows
    Then the endpoint is a named pipe
    And a Unix host keeps the runtime-directory socket path

  Scenario: The external control endpoint is absent on a Windows host
    Given a Windows Shell Host
    When the user-application system starts
    Then the external control endpoint is not provisioned
    And Shell-side Widget and App control remains available

  Scenario Outline: Windows sessions are recognized across launch forms
    Given a Windows process row whose command line is "<command>"
    When the desk scans the local process table
    Then that process is recognized as a Pi session

    Examples:
      | command                                                       |
      | pi                                                            |
      | pi.exe                                                        |
      | pi.cmd                                                        |
      | pi.ps1                                                        |
      | node C:\Users\desk\AppData\Roaming\npm\node_modules\pi\pi.js  |
      | "C:\Program Files\nodejs\node.exe" C:\tools\pi.mjs            |
      | cmd /c pi                                                     |
      | pwsh -Command pi                                              |
      | cmd.exe /c "C:\Program Files\nodejs\node.exe" C:\tools\pi.js   |
      | cmd /c "node" "C:\my tools\pi.js"                             |
      | npx pi                                                        |
      | pnpm exec pi                                                  |

  Scenario: A Windows process that is not Pi is never a session
    Given a Windows process row whose command line is not a Pi invocation
    When the desk scans the local process table
    Then that process is excluded from the session list
    And it is reported only as an unmatched process count

  Scenario: A working directory the host cannot read stays unknown
    Given a live Pi session on a Windows host whose working directory cannot be read
    When the desk reads that session
    Then its work directory is reported as unknown
    And no path is inferred from the executable, the command line, or the session goal

  Scenario: A process at a higher integrity level degrades to unknown
    Given a live Pi process the shell is not permitted to read
    When the desk inspects it
    Then the process is still reported as live by its identity and start time
    And its work directory is reported as unknown

  Scenario: An unloadable native module degrades instead of blocking
    Given the Windows process inspection module is not loadable
    When the operator starts the shell
    Then the shell starts
    And process inspection uses the managed fallback
    And every working directory the fallback cannot provide stays unknown

  Scenario: A link that is not ported reports unavailable rather than local
    Given a Windows Shell Host without a Remote Link service
    When the desk reads the Remote Link surface
    Then it reports unavailable
    And it does not report a local, simulated, or healthy link

  Scenario: The voice link binds the endpoint the host names
    Given a Windows Shell Host running the Voice Agent
    When the Shell reaches the voice service
    Then it reaches it at the voice-agent named pipe
    And the channel token authenticates the connection before the voice protocol reads a byte
    And a host with no voice service listening still reports voice as unavailable

  Scenario: The camera source reports unavailable without a device
    Given a Windows Shell Host without a V4L2 camera device
    When the camera tile reads its source
    Then it reports unavailable with no frame

  Scenario: Windows acceptance runs without bash
    Given a Windows Shell Host with dependencies installed
    When the operator runs the Node acceptance script
    Then it reports the smoke result for the configured content size
    And it checks that the shell document carries no inline styles and stays a skeleton

  Scenario: The reference host keeps its entry points and behavior
    Given the CM5 reference host
    When the existing bash smoke and release checks run
    Then they behave exactly as they did before Windows support

  Scenario: Host configuration is inventoried
    Given the runtime reads a configuration variable on the Windows path
    When the configuration inventory check runs
    Then that variable has a documented row naming a consumer that reads it