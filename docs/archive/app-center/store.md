# store

App Center package catalog (store stub). A fixed list of installable apps
mirroring the on-device content-package manifest shape. This is the seam a real
store backend plugs into: swap this module for one that fetches the list from a
store endpoint, and the install pipeline (launcher `register` + sandbox) is
unchanged. Each entry's `src` is a sandboxed Lua string from `apps/<name>.lua`.
