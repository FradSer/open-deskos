# Package appearance context: the Shell lends a package its theme

## Status

Accepted

## Context

An installed package is an opaque frame: it cannot read `data-theme`, inherit the Shell's custom properties, or load the Shell's font files. Every package therefore had to vendor its own palette, guess an appearance, and fall back to a platform font — so a package could never look like a built-in tile, however well it was built. That gap is what made a separately-installed weather tile read as a different theme from the desk around it, and it is the reason a package needed its own release-grade work to look correct.

The alternative to closing this gap is retiring packages in favour of built-in plugins only, which would put every future tile behind a runtime release. That is the opposite of what the model needs.

## Decision

- The Shell serves one appearance context into every package document: `<html data-theme="…">`, a stylesheet of resolved `--odk-*` tokens for **every** theme, the appearance's own `@font-face` declarations, and the measured tile radius (`--odk-radius-tile`).
- The theme travels on the frame URL (`?theme=`), so the first paint is already correct, and the frame module publishes later changes (`odk-user-app-theme`, carrying the theme and the radius) so a switch needs no reload. The injected handshake applies them inside the package, which means a package needs no theme code at all.
- Fonts are served from the running release over `odk-user-app://app/font/<id>` behind an allowlist of the faces the appearances declare. The scheme is registered `supportFetchAPI` + `corsEnabled` and the font response is CORS-open, because a package frame is sandboxed without same-origin authority; documents themselves stay non-enumerable.
- The context grants no authority: still no network, no Shell DOM, no preload, and no file outside the release. `connect-src 'none'` is unchanged.
- The injected values mirror `shell.css` and `themes/pixel.css`. `tests/user-app-context.cjs` compares them against the rendered Shell, so drift fails a test instead of shipping.
- The cell-relative text roles are expressed against the package's own viewport (`100cqi`), because a package frame *is* a cell; role names and ratios stay the ones the built-in surfaces use.

## Consequences

- A package can be authored in the built-in idiom — tokens, the appearance's face, `data-theme` branches — and look native with no vendored assets and no release of its own.
- Font bytes of the product faces are readable by any document the Shell frames. They are product assets, not secrets, and the route exposes nothing else.
- The verifier renders candidates with the base appearance's context, so a package that uses the context still verifies.
- The appearance contract is now a platform surface with its own feature file, tests, and a drift guard; changing a token is a two-file change (stylesheet and context) that a test enforces.

## Acceptance

`node --test tests/user-app-context.test.js tests/user-app-protocol.test.js tests/user-app-frame.test.js` covers token and face modelling, the allowlist, URL and message propagation, and the fallbacks. `pnpm exec electron tests/user-app-context.cjs` mounts a package in a real Home cell and asserts the theme attribute, every shared token against the rendered Shell, the served face, the measured radius, live theme switching with no reload, and that the frame still cannot reach the network.