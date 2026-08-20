# core.pager

Multi-page horizontal container, page indicators, and snapshot scrolling manager.

## Methods

- `create(parent, page_count, dots_parent)`: Create pager root and horizontal pages.
- `paint_page_dots(n)`: Update status-bar dot active indicator.
- `go_page(n, anim)`: Scroll to page index `n`.
- `refresh_page_snapshot(i)`: Pre-render RGB565 snapshot of page `i`.
- `prepare_page_snapshots()`: Pre-render snapshots for all pages.
- `on_scroll_end()`: Scroll settle callback.
- `current()`: Get current page index.
- `count()`: Get total page count.
