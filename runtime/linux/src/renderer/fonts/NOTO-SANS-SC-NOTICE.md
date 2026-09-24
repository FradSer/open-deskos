# Noto Sans SC notice

- Author: Google Noto project (Adobe and Google collaboration)
- Upstream: https://github.com/notofonts/noto-cjk
- Version: 2.004 (variable TTF, `Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf`)
- File: `NotoSansSC-Regular.ttf` (2360704 bytes), a static subset of that variable face
- Upstream source SHA-256: `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`
- Shipped file SHA-256: `d7c7755647033e0b5c1c0a8c3760b67b6da372ff469d36aad7ac1c3559518762`
- License: SIL Open Font License 1.1. Upstream copyright notice (verbatim):
  `Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.`
  The OFL text ships with the upstream repository at `Sans/LICENSE`; redistribution here keeps the
  font unmodified except for subsetting and static instancing, which the OFL permits.

## Coverage

ASCII, Latin-1, general punctuation, arrows, geometric shapes, CJK symbols and punctuation,
fullwidth forms, kana, and every Han character in GB2312 (6763). Non-GB2312 Han falls through the
`Zpix` face in the Shell's font stacks, and on the device through the system font installed by
`scripts/cm5-install.sh`.

CJK punctuation is part of the contract, not a nicety: an earlier subset of this face carried the
GB2312 Han characters but none of `，。：；！？、「」【】（）——……`, so every Chinese sentence ended in
tofu boxes wherever the Shell used this face instead of `Zpix`.

## Regenerating the subset

HarfBuzz `hb-subset` is the only tool that produced a subset this Chromium build renders; subsets
written by `fontTools` on macOS loaded as broken faces. The codepoint list is GB2312 (enumerated
through Python's `gb2312` codec) plus the Latin, punctuation, symbol, fullwidth, and kana ranges the
desk displays.

```
python3 - <<'PY'
cps = set()
for high in range(0xA1, 0xFA):
    for low in range(0xA1, 0xFF):
        try:
            cps.add(ord(bytes([high, low]).decode('gb2312')))
        except UnicodeDecodeError:
            pass
cps |= set(range(0x20, 0x7F))    # ASCII
cps |= set(range(0xA0, 0x100))   # Latin-1
cps |= set(range(0x2000, 0x2070))  # general punctuation
cps |= set(range(0x2190, 0x2200))  # arrows
cps |= set(range(0x2500, 0x2600))  # box drawing and geometric shapes
cps |= set(range(0x3000, 0x3040))  # CJK symbols and punctuation
cps |= set(range(0xFF00, 0xFFF0))  # fullwidth forms
open('unicodes.txt', 'w').write('\n'.join(f'{c:04X}' for c in sorted(cps)))
PY

hb-subset NotoSansSC-VF.ttf --variations="wght=400" --unicodes-file=unicodes.txt \
  -o NotoSansSC-Regular.ttf
```

The variable face defaults to the Thin instance, so the static instance's name records are rewritten
to `Noto Sans SC / Regular` before shipping.