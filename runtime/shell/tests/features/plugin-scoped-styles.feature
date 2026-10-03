Feature: Plugin scoped styles
  # registry 是样式的接缝：插件声明 css，activate 时注入，deactivate 不卸载。

  Scenario: Plugin with css injects a scoped stylesheet on activate
    Given a tile plugin declaring css "plugins/weread.css"
    When the plugin is activated
    Then the document head contains one link for that plugin after shell.css

  Scenario: Repeated activation does not duplicate the stylesheet
    Given a tile plugin declaring css "plugins/weread.css" already activated once
    When the plugin is activated again on another element
    Then the document head still contains only one link for that plugin

  Scenario: Plugin without css injects nothing
    Given a tile plugin with no css declaration
    When the plugin is activated
    Then the document head contains no link for that plugin

  Scenario: Invalid css declaration is rejected at registration
    Given a tile plugin declaring css "../outside.css"
    When the plugin is registered
    Then registration fails with an invalid css error

  Scenario: Deactivation keeps the stylesheet loaded
    Given a tile plugin declaring css "plugins/weread.css" already activated once
    When the plugin is deactivated
    Then the document head still contains the link for that plugin
