Feature: Open DeskOS Data is read through the plugin system

  Background:
    Given the Shell holds a Hydra reading, a weather instrument, a Futu Service Plugin, and one installed package

  Scenario: A selected Link implementation serves the existing Personal Agent
    Given the default or an alternative Open DeskOS Data Link uses the selected registry
    When the Personal Agent lists and reads through the existing client
    Then both implementations return current readings and untrusted package values
    And the Link rejects mutation requests
    And disabling the Link releases its listener without discarding published values
    And enabling the Link restores the same readings
    And the alternative never starts the default listener

  Scenario: A spoken question about a plant is answered from the tile's own reading
    Given the Hydra source is connected and one plant's soil is 30 percent
    When the Personal Agent reads the Hydra Open DeskOS Data
    Then the answer carries the same 30 percent reading the tile is drawing
    And the reading is reported as live rather than estimated

  Scenario: One reading serves the tile and the spoken answer
    Given a registered reading changed after the tile last drew
    When the tile and the Personal Agent read that registered reading
    Then both receive the current reading from the one source

  Scenario Outline: An instrument state reaches the reader as itself
    Given the weather instrument is <state>
    When the Personal Agent reads the weather Open DeskOS Data
    Then the reading is reported as <state>
    And no temperature, place or daily range is presented as current

    Examples:
      | state        |
      | unconfigured |
      | unavailable  |
      | stale        |

  Scenario: Reading a Open DeskOS Data source never forces a provider request
    Given the weather instrument already read the provider inside its freshness interval
    When the Personal Agent reads the weather Open DeskOS Data
    Then no further provider request is made for that read

  Scenario: A Service Plugin reading is answerable by its declared id
    Given the Futu poller published a holdings snapshot
    When the Personal Agent lists and reads Open DeskOS Data
    Then the poller's reading is listed under the service id its package declared
    And reading it returns the published snapshot
    And no other id answers for that same reading

  Scenario: A Service Plugin that is not live presents no holdings
    Given the Futu poller's last snapshot is older than its own freshness window
    When the Personal Agent reads that service's Open DeskOS Data
    Then the reading is reported as the plugin reported itself
    And no holdings are presented

  Scenario: The installed Widget and App catalog is readable
    Given the Shell has two installed packages, one of them placed on a grid page
    When the Personal Agent reads the installed catalog
    Then it lists both packages with their kind, version and placement

  Scenario: Listing names every reading without reading any of them
    Given a reading whose source counts how many times it has been read
    When the Personal Agent lists Open DeskOS Data
    Then the listing names that reading with its id and kind
    And the source has not been read

  Scenario: A reading publishes the percent the tile draws, and drops a ratio whose scale nothing declares
    Given a source reports one ratio the tile formats as a percent and another no display draws
    When the Personal Agent reads that Open DeskOS Data
    Then the ratio the tile draws is published as that same percent
    And the ratio no display draws is not published under a percent name
    And the loss and the value it is a loss against are both published

  Scenario: A reading whose own fields name a token is still a reading
    Given an installed package declared a field named token
    When the Personal Agent reads that reading
    Then the reading arrives rather than the request timing out

  Scenario: A frame that is not this protocol is named at once
    Given the link answered with a frame that is not its own
    When the Personal Agent reads Open DeskOS Data
    Then the failure names the wrong frame
    And it does not wait out the request timeout to say so

  Scenario: A package publishes inside its declaration
    Given an installed Widget declares data with the field remaining_seconds
    When the package publishes remaining_seconds through the package bridge
    Then the reading joins the registry under the package's id
    And a reader receives the published value

  Scenario: A package cannot publish outside its declaration
    Given an installed Widget declares only remaining_seconds
    When the package publishes a field it did not declare
    Then the value is refused
    And the previously published reading is unchanged

  Scenario: A package without a declaration publishes nothing
    Given an installed Widget declares no data
    When its document calls the package bridge
    Then nothing joins the registry
    And no reading names that package

  Scenario: A published value is data and never an instruction
    Given a package published a value containing text that tells the agent to disregard its instructions
    When the Personal Agent reads that reading
    Then the value is returned as reading content
    And it is labelled untrusted data rather than an instruction

  Scenario: A replaced package revision cannot answer with the previous value
    Given an installed Widget published a reading
    When that package's installed revision is replaced
    Then its reading is unconfigured again
    And the previous revision's value is no longer readable

  Scenario: The Open DeskOS Data Link changes nothing
    Given the Personal Agent is connected to the Open DeskOS Data Link
    When it sends a request that is neither a list nor a read
    Then the request is refused
    And every registered reading is unchanged

  Scenario: A second read returns the current reading
    Given the Personal Agent read a reading once
    When the source's reading changes and the agent reads again
    Then the second read returns the changed reading
    And no cached copy is returned

  Scenario: An unknown reading is refused rather than answered empty
    When the Personal Agent reads an id no plugin registered
    Then the read is refused as an unknown reading
    And no reading is returned in its place

  Scenario: An absent Shell is truthfully unavailable
    Given no Shell is listening on the Open DeskOS Data Link
    When the Personal Agent reads Open DeskOS Data
    Then the failure is reported as the desk being unavailable
    And no remembered value is presented as current

  Scenario: An oversized reading is refused rather than truncated
    Given a source published a reading larger than the link allows
    When the Personal Agent reads it
    Then the response is refused as too large
    And no partial reading is presented as a complete one

  Scenario: Both profiles read the same desk
    Given the coding coordinator and the personal assistant are both running
    When each reads the Hydra Open DeskOS Data
    Then both receive the same reading

  Scenario: One desk channel failing says nothing about another
    Given a different desk tool on this host reports an error
    When the owner asks what their widgets are showing
    Then the reading tool is still used to answer
    And no earlier answer about that reading is offered instead

  Scenario: A reading names only what a spoken answer needs
    Given a source publishes device diagnostics, a cover image and vendor status codes beside its measurements
    When the Personal Agent reads that Open DeskOS Data
    Then the reading carries the measurements under plain names with the time each was measured
    And it carries no image, no firmware detail and no vendor status code

  Scenario: A Pi session reading preserves reporting provenance without granting control
    Given a reported Pi session claims a configured control target in its source data
    When the Personal Agent reads the Pi session reading
    Then the reading names the reporting machine and remains report_only
    And it publishes no control target, endpoint, or control attribution
    And a missing reporting machine remains null rather than inferred

  Scenario: A reading states its own time so a stale answer cannot be called live
    Given a source's last measurement is older than its own freshness window
    When the Personal Agent reads that Open DeskOS Data
    Then the reading carries the time each measurement was taken
    And the reading is reported as the source reported itself


  Scenario: An older catalog synchronization cannot restore a removed package
    Given an installed package has published data
    And its catalog synchronization is waiting for an older snapshot
    When a newer synchronization removes that package
    And the older catalog snapshot arrives
    Then the package remains absent from Open DeskOS Data
    And its previous publication does not return

  Scenario: An older catalog synchronization cannot overwrite a new revision
    Given a package catalog synchronization is waiting for an older revision
    When a newer synchronization registers the current revision
    And the current revision publishes data
    And the older catalog snapshot arrives
    Then readers still receive the current revision's published data
    And source and service readings remain available

  Scenario: An unreadable current catalog retains committed package state
    Given a package has published data
    And an older catalog synchronization is waiting
    When a newer synchronization cannot read the catalog or receives a malformed catalog
    And the older catalog snapshot arrives
    Then the last committed package declaration and publication remain unchanged
    And the older pending synchronization does not regain authority

  Scenario: Windows replacement Links use private authenticated pipes
    Given the default or alternative Link uses a unique test pipe and private token
    When the actual Personal Agent reads the selected registry
    Then both Links preserve the same reading and mutation-refusal behavior
    And disabling either Link prevents new connections
    And enabling either Link restores its retained readings
    And the test never connects to a product pipe or token


  Scenario: Selected registries retain source read errors and byte bounds
    Given the default or signed selected registry serves a controlled source
    When control and the actual Personal Agent read a value at the UTF-8 byte limit
    Then both return the complete value without truncation
    When the source exceeds that limit or fails
    Then both refuse that reading with the existing error
    And another source remains readable
    When the source recovers
    Then both read the new value without a cached substitute

  Scenario: Resident producer plugins contribute through the existing Data registry
    Given task and remote report plugins declare bounded public source projections
    When the Shell discovers their authenticated producer declarations
    Then each declared reading joins the existing registry
    And listing reads no source values
    And each reading request resolves the current owner without a second value cache
    When a producer or its connection becomes unavailable
    Then no previous live value replaces the failed read
    And the next declaration refresh withdraws unavailable readings
    When the provider stops during a request
    Then shutdown drains that request and refuses its late declarations
