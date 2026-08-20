# core.hero_navigator

Geometric hero transition and App Runtime lifecycle manager.

## Methods

- `init(shell_root)`: Initialize navigator with shell screen.
- `open_app(app_id, source_rect)`: Animate hero expansion and load fullscreen App.
- `request_dismiss()`: Queue app dismiss for next tick.
- `go_home()`: Reverse hero animation back to home widget.
- `on_tick(now_ms)`: Drive transition interpolation and active app ticks.
- `is_active()`: Check if transition or app is currently active.
- `is_in_app()`: Check if fully inside an App.
- `get_active_app()`: Get currently active App ID.
