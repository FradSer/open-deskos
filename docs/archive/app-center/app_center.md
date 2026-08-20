# app_center

App Center UI (Homepage/#3): a scrollable catalog of Apps that open directly on
tap. The App Manager owns registration and lifecycle; this module only renders
rows and forwards the catalog entry to `ctx.add_lua_app` and `ctx.open`. There
is no intermediate detail or install-selection screen. Catalog data comes from
`store.lua`.
