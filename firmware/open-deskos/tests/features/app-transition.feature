Feature: Widget-to-App continuation and live peek
  Widgets state truthful values first. An App continues the Widget state and
  extends it with task content. UI emits intent; the platform seam routes it
  through Installer, App Manager, and App Runtime.

  Scenario: Widget tap opens the corresponding App
    Given a widget with interaction "open-app" and an installed App
    When the user taps the widget
    Then the UI emits an open-app intent with app_id and route
    And Installer confirms the App is installed
    And App Manager starts the foreground App
    And App Runtime receives on_start(ctx)
    And the App keeps the source widget context

  Scenario: Display-only widget remains truthful
    Given a widget with interaction "display-only" and no App
    When the user taps the widget
    Then no App Manager start occurs
    And the Widget remains a truthful state surface

  Scenario: Peek carries the active App state
    Given a foreground App is running
    When its live state changes
    Then the Shell publishes the state to peek
    And peek offers a touch entry back into the active App

  Scenario: Unified App Manager replaces dock and icon piles
    Given the Shell is showing the home screen
    Then no dock or desktop icon pile is rendered
    And one unified App Manager entry opens the installed App list
    And the list shows kind, version, capabilities, and lifecycle state

  Scenario: Full plugin lifecycle releases resources
    Given a plugin is enabled and mounted
    When the plugin is stopped and unmounted
    Then it receives stop before unmount
    And it releases tick subscriptions and runtime resources
    And disable and uninstall complete without leaving a live callback

  Scenario: Back returns to the Widget source context
    Given the user opened an App from a Widget with a route
    When the user presses Back or Escape
    Then App Runtime receives on_stop(ctx)
    And App Manager releases the foreground instance
    And the original page, Widget, and route context are restored
