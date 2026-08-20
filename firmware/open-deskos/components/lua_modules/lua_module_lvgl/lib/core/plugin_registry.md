# core.plugin_registry

Central registry and catalog for Open DeskOS plugins and extensions.

## Methods

- `register(spec)`: Register a plugin table.
- `get(id)`: Lookup a registered plugin by ID.
- `list()`: Returns all registered plugins.
- `get_widget(id, size)`: Retrieve widget builder for plugin and size.
- `get_app(id)`: Retrieve app definition.
- `get_dashboard_providers()`: Return active dashboard metric providers.
- `get_peek_provider(id)`: Return active peek provider.
- `unregister(id)`: Remove a plugin.
- `clear()`: Reset registry.
