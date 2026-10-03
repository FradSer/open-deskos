Feature: Desk Data is read through the plugin system

  Background:
    Given the Shell holds a Hydra reading, a weather instrument, a Futu Service Plugin, and one installed package

  Scenario: A spoken question about a plant is answered from the tile's own reading
    Given the Hydra source is connected and one plant's soil is 30 percent
    When the Personal Bot reads the Hydra Desk Data
    Then the answer carries the same 30 percent reading the tile is drawing
    And the reading is reported as live rather than estimated

  Scenario: One reading serves the tile and the spoken answer
    Given a registered reading changed after the tile last drew
    When the tile and the Personal Bot read that registered reading
    Then both receive the current reading from the one source

  Scenario Outline: An instrument state reaches the reader as itself
    Given the weather instrument is <state>
    When the Personal Bot reads the weather Desk Data
    Then the reading is reported as <state>
    And no temperature, place or daily range is presented as current

    Examples:
      | state        |
      | unconfigured |
      | unavailable  |
      | stale        |

  Scenario: Reading a Desk Data source never forces a provider request
    Given the weather instrument already read the provider inside its freshness interval
    When the Personal Bot reads the weather Desk Data
    Then no further provider request is made for that read

  Scenario: A Service Plugin reading is answerable by its declared id
    Given the Futu poller published a holdings snapshot
    When the Personal Bot lists and reads Desk Data
    Then the poller's reading is listed under the service id its package declared
    And reading it returns the published snapshot
    And no other id answers for that same reading

  Scenario: A Service Plugin that is not live presents no holdings
    Given the Futu poller's last snapshot is older than its own freshness window
    When the Personal Bot reads that service's Desk Data
    Then the reading is reported as the plugin reported itself
    And no holdings are presented

  Scenario: The installed Widget and App catalog is readable
    Given the Shell has two installed packages, one of them placed on a grid page
    When the Personal Bot reads the installed catalog
    Then it lists both packages with their kind, version and placement

  Scenario: Listing names every reading without reading any of them
    Given a reading whose source counts how many times it has been read
    When the Personal Bot lists Desk Data
    Then the listing names that reading with its id and kind
    And the source has not been read

  Scenario: A reading publishes the percent the tile draws, and drops a ratio whose scale nothing declares
    Given a source reports one ratio the tile formats as a percent and another no display draws
    When the Personal Bot reads that Desk Data
    Then the ratio the tile draws is published as that same percent
    And the ratio no display draws is not published under a percent name
    And the loss and the value it is a loss against are both published

  Scenario: A reading whose own fields name a token is still a reading
    Given an installed package declared a field named token
    When the Personal Bot reads that reading
    Then the reading arrives rather than the request timing out

  Scenario: A frame that is not this protocol is named at once
    Given the link answered with a frame that is not its own
    When the Personal Bot reads Desk Data
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
    When the Personal Bot reads that reading
    Then the value is returned as reading content
    And it is labelled untrusted data rather than an instruction

  Scenario: A replaced package revision cannot answer with the previous value
    Given an installed Widget published a reading
    When that package's installed revision is replaced
    Then its reading is unconfigured again
    And the previous revision's value is no longer readable

  Scenario: The Desk Data Link changes nothing
    Given the Personal Bot is connected to the Desk Data Link
    When it sends a request that is neither a list nor a read
    Then the request is refused
    And every registered reading is unchanged

  Scenario: A second read returns the current reading
    Given the Personal Bot read a reading once
    When the source's reading changes and the agent reads again
    Then the second read returns the changed reading
    And no cached copy is returned

  Scenario: An unknown reading is refused rather than answered empty
    When the Personal Bot reads an id no plugin registered
    Then the read is refused as an unknown reading
    And no reading is returned in its place

  Scenario: An absent Shell is truthfully unavailable
    Given no Shell is listening on the Desk Data Link
    When the Personal Bot reads Desk Data
    Then the failure is reported as the desk being unavailable
    And no remembered value is presented as current

  Scenario: An oversized reading is refused rather than truncated
    Given a source published a reading larger than the link allows
    When the Personal Bot reads it
    Then the response is refused as too large
    And no partial reading is presented as a complete one

  Scenario: Both profiles read the same desk
    Given the coding coordinator and the personal assistant are both running
    When each reads the Hydra Desk Data
    Then both receive the same reading

  Scenario: One desk channel failing says nothing about another
    Given a different desk tool on this host reports an error
    When the owner asks what their widgets are showing
    Then the reading tool is still used to answer
    And no earlier answer about that reading is offered instead

  Scenario: A reading names only what a spoken answer needs
    Given a source publishes device diagnostics, a cover image and vendor status codes beside its measurements
    When the Personal Bot reads that Desk Data
    Then the reading carries the measurements under plain names with the time each was measured
    And it carries no image, no firmware detail and no vendor status code

  Scenario: A reading states its own time so a stale answer cannot be called live
    Given a source's last measurement is older than its own freshness window
    When the Personal Bot reads that Desk Data
    Then the reading carries the time each measurement was taken
    And the reading is reported as the source reported itself
