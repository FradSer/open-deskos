# core.widget_engine

Widget layout, sizing calculation, and lifecycle instantiation engine.

## Methods

- `parse_size(size_str)`: Parses size string (e.g. "2x1") into `col_span, row_span`.
- `calculate_rect(g, col, row, col_span, row_span)`: Calculates physical pixel rectangle `{ x, y, w, h }`.
- `create_widget(parent, item, host_ctx)`: Instantiates a multi-size widget and attaches lifecycle callbacks.
