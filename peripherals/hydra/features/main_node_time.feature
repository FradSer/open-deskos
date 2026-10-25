Feature: Main-node time synchronization
  The main node synchronizes wall time over SNTP and stores it in its BM8563 RTC.
  It broadcasts the best time it has to sub-nodes so their time-of-day and seasonal
  watering gates stay correct: the SNTP-disciplined system clock whenever one
  exists, and the RTC as the fallback before the first sync and on a network where
  NTP never answers.

  Scenario: An unset RTC produces an invalid environment time slice
    Given the main-node RTC year is before 2024
    When an environment time slice is built
    Then its hour, minute, and month are all 0xFF

  Scenario: A valid RTC produces an environment time slice
    Given the main-node RTC reads 2026-07-18 14:35
    When an environment time slice is built
    Then its hour is 14
    And its minute is 35
    And its month is 7

  Scenario: SNTP begins only once after Wi-Fi connects
    Given SNTP has not started
    When Wi-Fi connects
    Then SNTP should start
    When the time service runs again while Wi-Fi remains connected
    Then SNTP should not start again

  Scenario: A synchronized system clock is written to the RTC once
    Given SNTP has synchronized a valid system clock
    And the RTC has not been synchronized from it
    When the time service evaluates RTC synchronization
    Then the RTC should be written
    When the time service evaluates RTC synchronization again
    Then the RTC should not be written again

  Scenario: A disciplined system clock outranks the drifting RTC
    Given SNTP has synchronized the system clock to 02:40
    And the free-running RTC reads 02:29
    When the environment time slice is selected
    Then its hour is 2
    And its minute is 40

  Scenario: The RTC is the fallback before the first sync
    Given SNTP has not synchronized a system clock
    And the RTC reads 2026-09-22 02:29
    When the environment time slice is selected
    Then its hour is 2
    And its minute is 29

  Scenario: SNTP is re-armed while a sync has not landed
    Given Wi-Fi is connected
    And SNTP has started but never synchronized
    When the retry window elapses
    Then SNTP should start again
