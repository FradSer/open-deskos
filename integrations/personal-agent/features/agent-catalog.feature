Feature: Personal Agent installs declarative Skills and MCP packages
  Scenario: A Skill installation uses an immutable source snapshot
    Given a local Skill directory with valid metadata and bounded text resources
    When the owner installs that directory
    Then the catalog retains its exact content under a content-derived revision
    And later source edits cannot change the installed Skill
    And reading a resource cannot escape the installed package
    And installation does not execute Skill scripts
    And Code Mode passes the inspected id and revision as data without regenerating revision strings

  Scenario: A package update can be removed or rolled back
    Given an installed package and a previous valid revision
    When the owner selects a previous revision or removes the package
    Then the selected installed revision changes atomically
    And previous source snapshots remain available
    And an invalid update preserves the active revision

  Scenario: MCP installation declares an explicit transport
    Given an owner-supplied MCP manifest
    When the catalog validates its transport and credential references
    Then it accepts stdio or Streamable HTTP configuration
    And it rejects native Pi extension declarations and embedded credentials
    And installation does not start a process or contact a server

  Scenario: Catalog state rejects filesystem aliases
    Given a linked, shared, corrupt, or oversized package snapshot
    When the catalog reads or changes that package
    Then it refuses the operation without changing the active revision

  Scenario: An installed MCP server executes through the maintained client
    Given an installed stdio or Streamable HTTP MCP manifest
    When a task discovers tools and calls a declared tool
    Then the client validates arguments against the discovered JSON Schema
    And it validates successful structured results against output schemas from all discovery pages
    And provider credentials do not enter the server environment
    And known connector credentials do not enter returned results
    And closing the connector releases its transport and child process

  Scenario: MCP interruption never replays a call
    Given an MCP tool has started a side effect
    When its connection fails or its task is cancelled
    Then the caller receives an unknown-outcome failure
    And the client does not repeat the tool call

  Scenario: Untrusted MCP data remains bounded
    Given a server returns excessive schemas or response bytes
    When the client receives those data
    Then it reports incomplete discovery or an oversized result
    And it does not execute an undiscovered tool

  Scenario: MCP schema changes invalidate the cached discovery
    Given a connected MCP server changes its declared tools
    When the client receives a tool-list change notification
    Then the next discovery reads the new tool declarations
    And incomplete old discovery cannot replace the new schemas
    And a late old response cannot change validation of current tool results

  Scenario: Task-only MCP tools are rejected before execution
    Given a tool requires the MCP task execution protocol
    When the Personal Agent requests a synchronous call
    Then it reports unsupported task execution before dispatch
    And no tool side effect occurs
