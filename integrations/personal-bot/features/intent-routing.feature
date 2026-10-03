Feature: Every Personal Bot user turn is routed by Jev
  Scenario: All routed capabilities support historical direct calls without bypassing Code Mode
    Given either profile has registered reviewed capabilities and a historical direct tool call
    When Jev selects an intent and the model invokes an exact allowed capability directly or through codemode
    Then both entries use the same validated capability and intent gate
    And codemode remains the only model-facing orchestration entry
    And tools from other intents are neither activated nor executable

  Scenario: Invalid or failed calls never cause mutation replay
    Given a routed capability changes state or its outcome is unknown
    When its name is unknown, its arguments are invalid, or execution fails
    Then no automatic alias substitution or execution retry occurs
    And the error keeps its original meaning rather than claiming an unrelated service is unavailable
    And identical mutation attempts are reserved once per turn across direct and nested calls
    And read-only status queries can repeat while a new explicit turn receives a fresh attempt budget

  Scenario: Tool activation belongs to one actual user turn
    Given Jev selected an intent with active capabilities
    When that turn completes, fails or is cancelled
    Then the selected direct capability entries are deactivated
    And uncertain or failed inference cannot reuse a previous turn's entries

  Scenario: Existing placement changes differ from Widget source changes
    Given an installed Widget and a request that changes only its desktop placement or grid span
    When Jev classifies moving or resizing that installed Widget
    Then it selects app_manage rather than Widget drafting
    But changing the Widget's source, content, appearance or behavior selects widget_create
    And initial placement requested together with a new Widget remains part of widget_create

  Scenario: All user inputs pass through Jev before a handler runs
    Given a Personal Bot in the coding or personal profile
    When the user asks to continue a Pi session, query tasks, create a Widget or App, query suggestions, confirm an action, or chat
    Then Jev selects a typed intent before memory, proposal queries, Pi prompts or capability execution
    And the selected intent dispatches its own workflow using the unchanged user request

  Scenario: Uncertainty and provider failures cannot bypass Jev
    Given an ambiguous intent, malformed judgment, missing credential or failed Jev request
    When the user sends a turn
    Then no task or application mutation is executed
    And uncertain intents ask for clarification while inference failures report unavailable
    And there is no regular-expression or reasoning-model routing fallback

  Scenario: A task query cannot become a task mutation
    Given Jev selects the read-only task query intent
    When a reasoning model attempts to start, prompt, cancel or end a task
    Then the intent-specific capability boundary rejects that call
    And query handlers resolve current targets and session identities from actual tools

  Scenario: An application query cannot become a lifecycle mutation
    Given the user asks which Widgets or Apps are installed or where they are placed
    When Jev selects the read-only application query intent
    Then listing and desktop discovery are available
    And installation, movement, removal and rollback are neither active nor executable

  Scenario: Cancelling intent inference ends that turn
    Given a Jev request is pending
    When the user cancels the Personal Bot turn or closes the agent
    Then the Jev request is aborted and no downstream handler starts
    And the next user turn receives a fresh judgment

  Scenario: Displayed proposal confirmations retain context during host reservation
    Given an action uses an exact displayed remember or execute confirmation
    When the host reserves a touch acceptance before invoking the action callback
    Then its executing proposal still supplies the displayed confirmation to Jev
    And independent remember requests still use the private memory workflow

  Scenario: Personal profile coordinates Widgets and Apps without generic implementation tools
    Given reviewed personal tools and configured Hosted Pi targets
    When Jev selects Widget or App creation
    Then the coordinator delegates drafting and checks to a configured target
    And existing lifecycle and explicit-installation authorization remain required
    And generic source-editing and shell tools remain unavailable

  Scenario: Operator-added capabilities retain a routed extension workflow
    Given a reviewed operator-added capability outside the core intent methods
    When Jev selects the extension handler from its name and description
    Then only extension capabilities and shared read-only context tools can execute
    And a conversation or task query cannot invoke that extension
    And the extension handler cannot substitute a core mutation

  Scenario: Agent closure reaches a pending proposal action
    Given a reviewed capability has begun a Jev-routed proposal action
    When the agent closes before the action settles
    Then the action receives the aborted lifetime signal
    And the caller reports its actual outcome without replaying it

  Scenario: Personal plant questions can read the desk's live measurements
    Given the Personal Bot runs in the personal profile and the plant channel is live
    When the user asks "今天花怎么样" and Jev selects desk_data
    Then the personal session can list readings and read the plant measurement
    And the answer uses this turn's reading rather than remembered values
    And sensor connectivity and soil moisture alone are not claimed to prove plant health or watering needs

  Scenario: A historical direct tool failure is not a plant-channel failure
    Given an older session contains a direct desk_data call reporting Tool desk_data not found
    When Jev routes a new plant question to desk_data
    Then the workflow directs the model to codemode and tools.desk_data
    And the current read succeeds through the real SDK tool pipeline
    And the answer does not substitute historical measurements
