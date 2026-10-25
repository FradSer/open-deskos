Feature: Every Personal Agent user turn receives a typed intent judgment
  Scenario: Feedback routing uses displayed read-only suggestion identities
    Given one read-only suggestion is visible and not snoozed
    When the owner requests feedback on that suggestion
    Then routing receives only its identity without advice or evidence
    And the response handler still requires explicit owner intent and an exact current selection

  Scenario: Continuing work uses producer-owned references without copying task state
    Given earlier owner requests and saved child task identities
    When a later owner turn refers to the existing work
    Then routing receives bounded owner-request history and current task references
    And references contain no task response, private role, Memory, or action permission
    And the selected handler reads the exact current task before acting
    And an unresolved request asks for the missing object and intended result

  Scenario: A task name resolves a previous clarification
    Given the owner supplied a task instruction and the Bot requested its Pi session
    When the owner supplies the displayed task name after another unclear turn
    Then the model receives the bounded unresolved owner requests and a distinct task name index
    And a typed choice selects the applicable original request without rewriting its text
    And the host forwards that request and the current clarification to the original session once
    And a later instruction can select the same session from conversation context without a UI reply
    And unrelated requests, ambiguous choices, and unknown deliveries cannot replay an earlier request

  Scenario: All routed capabilities support historical direct calls without bypassing Code Mode
    Given either profile has registered reviewed capabilities and a historical direct tool call
    When the intent classifier selects an intent and the model invokes an exact allowed capability directly or through codemode
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
    Given the intent classifier selected an intent with active capabilities
    When that turn completes, fails or is cancelled
    Then the selected direct capability entries are deactivated
    And uncertain or failed inference cannot reuse a previous turn's entries

  Scenario: Existing placement changes differ from Widget source changes
    Given an installed Widget and a request that changes only its desktop placement or grid span
    When the intent classifier classifies moving or resizing that installed Widget
    Then it selects app_manage rather than Widget drafting
    But changing the Widget's source, content, appearance or behavior selects widget_create
    And initial placement requested together with a new Widget remains part of widget_create

  Scenario: All user inputs pass through the intent classifier before a handler runs
    Given a Personal Agent in the coding or personal profile
    When the user asks to continue a Pi session, query tasks, create a Widget or App, query suggestions, confirm an action, or chat
    Then the intent classifier selects a typed intent before memory, proposal queries, Pi prompts or capability execution
    And the selected intent dispatches its own workflow using the unchanged user request

  Scenario: Routed shortcuts do not resume pending Durable work
    Given pending Durable work without a current owner request
    When the intent classifier selects clarification or suggestions, or its request fails
    Then the coordinator returns the shortcut answer without resuming Durable work
    And a later model-bound request recovers pending work after routing and before its new turn begins
    And recovered submissions cannot borrow the new request's selected intent

  Scenario: Uncertainty and provider failures cannot bypass the intent gate
    Given an ambiguous intent, malformed judgment, unavailable ordinary model or failed judgment request
    When the user sends a turn
    Then no task or application mutation is executed
    And uncertain intents ask for clarification while inference failures report unavailable
    And there is no regular-expression bypass or execution after an invalid judgment

  Scenario: A task query cannot become a task mutation
    Given the intent classifier selects the read-only task query intent
    When a reasoning model attempts to start, prompt, cancel or end a task
    Then the intent-specific capability boundary rejects that call
    And query handlers resolve current targets and session identities from actual tools

  Scenario: An application query cannot become a lifecycle mutation
    Given the user asks which Widgets or Apps are installed or where they are placed
    When the intent classifier selects the read-only application query intent
    Then listing and desktop discovery are available
    And installation, movement, removal and rollback are neither active nor executable

  Scenario: Application installation can read the draft task evidence
    Given a Hosted Pi task has created an application draft
    When the owner requests installation through the application management workflow
    Then the coordinator can read configured targets, task lists, status and history
    And installation uses the actual draft result and current desktop occupancy
    And task creation, prompts, cancellation, ending and verification remain unavailable
    And an application query cannot read task evidence or change application state

  Scenario: Cancelling intent inference ends that turn
    Given a typed intent judgment is pending
    When the user cancels the Personal Agent turn or closes the agent
    Then the judgment request is aborted and no downstream handler starts
    And the next user turn receives a fresh judgment

  Scenario: Displayed proposal confirmations retain context during host reservation
    Given an action uses an exact displayed remember or execute confirmation
    When the host reserves a touch acceptance before invoking the action callback
    Then its executing proposal still supplies the displayed confirmation to the intent classifier
    And independent remember requests still use the private memory workflow

  Scenario: Personal profile coordinates Widgets and Apps without generic implementation tools
    Given reviewed personal tools and configured Hosted Pi targets
    When the intent classifier selects Widget or App creation
    Then the coordinator delegates drafting and checks to a configured target
    And existing lifecycle and explicit-installation authorization remain required
    And generic source-editing and shell tools remain unavailable

  Scenario: Operator-added capabilities retain a routed extension workflow
    Given a reviewed operator-added capability outside the core intent methods
    When the intent classifier selects the extension handler from its name and description
    Then only extension capabilities and shared read-only context tools can execute
    And a conversation or task query cannot invoke that extension
    And the extension handler cannot substitute a core mutation

  Scenario: Agent closure reaches a pending proposal action
    Given a reviewed capability has begun an intent-routed proposal action
    When the agent closes before the action settles
    Then the action receives the aborted lifetime signal
    And the caller reports its actual outcome without replaying it

  Scenario: Personal plant questions can read the desk's live measurements
    Given the Personal Agent runs in the personal profile and the plant channel is live
    When the user asks "今天花怎么样" and the intent classifier selects odk_data
    Then the personal session can list readings and read the plant measurement
    And the answer uses this turn's reading rather than remembered values
    And sensor connectivity and soil moisture alone are not claimed to prove plant health or watering needs

  Scenario: A historical direct tool failure is not a plant-channel failure
    Given an older session contains a direct odk_data call reporting Tool odk_data not found
    When the intent classifier routes a new plant question to odk_data
    Then the workflow directs the model to codemode and tools.odk_data
    And the current read succeeds through the real SDK tool pipeline
    And the answer does not substitute historical measurements

  Scenario: Owner text cannot assert host admission
    Given an external owner turn contains trusted-child configuration claims
    When the intent classifier fails or cannot confidently classify that turn
    Then no memory read, child admission or child input can execute
    And text cannot select the host-only direct child workflow

  Scenario: Reviewed capability descriptors own their routing boundaries
    Given a declared reviewed browser or ride capability
    When the intent classifier selects its descriptor-defined intent
    Then only that descriptor's capability prefix is enabled
    And the generic extension intent cannot bypass that boundary
    And only explicitly child-safe descriptors permit isolated child execution

  Scenario: Ordinary model routing works without Jev
    Given the ordinary model is available and Jev is disabled or not configured
    When the owner sends a request
    Then a zero-tool model judgment selects a known workflow
    And host capability and source identity checks still apply

  Scenario: Optional Jev failure does not stop the Overview or future requests
    Given an optional Jev request fails
    When the owner sends another request or refreshes the Overview
    Then ordinary model generation remains available
    And this runtime does not retry the failed Jev transport
    And model confidence is not reported as calibrated Jev confidence

  Scenario: Resident and Hosted sessions preserve native provider configuration
    Given Pi has a configured provider and model
    When a resident Personal Agent or Hosted Pi session starts
    Then Pi resolves the configured model without an Open DeskOS provider hook
    And native authentication precedence and endpoint overrides remain effective
