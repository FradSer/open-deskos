# almanac

Hong Kong Chinese almanac (黃曆/通勝) calculation library. Provides Gregorian-to-lunar
conversion, Heavenly Stems/Earthly Branches (干支), zodiac, 宜忌 (auspicious/avoid) tables,
and solar terms.

## API

- `almanac.today()` — full almanac for today
- `almanac.almanac(year, month, day)` — full almanac for a given date
- `almanac.lunar_date(year, month, day)` — lunar date info only
- `almanac.year_ganzhi(year, month, day)` — year stem/branch/zodiac (lichun-aware)
- `almanac.month_ganzhi(year, month, day, year_stem)` — month stem/branch
- `almanac.day_ganzhi(year, month, day)` — day stem/branch
- `almanac.yi_ji(branch)` — 宜忌 for a given day branch
- `almanac.chong(branch)` — animal being 冲
- `almanac.get_solar_term(year, month, day)` — solar term name or nil
- `almanac.weekday_name(year, month, day)` — Chinese weekday name
- `almanac.is_leap_year(year)` — Gregorian leap year check

## Almanac table fields

| field | description |
|---|---|
| `gregorian` | `{year, month, day}` |
| `lunar.year` | lunar year number |
| `lunar.month` | lunar month number (1-12) |
| `lunar.day` | lunar day number (1-30) |
| `lunar.leap` | boolean, is leap month |
| `lunar.month_name` | e.g. "正月", "閏二月" |
| `lunar.day_name` | e.g. "初一", "十五" |
| `lunar.year_ganzhi` | e.g. "丙午" |
| `lunar.month_ganzhi` | e.g. "丁酉" |
| `lunar.day_ganzhi` | e.g. "壬子" |
| `lunar.zodiac` | e.g. "馬" |
| `solar_term` | string or nil |
| `chong` | e.g. "沖馬" |
| `yi` | array of auspicious activities |
| `ji` | array of inauspicious activities |

## Coverage

Lunar data covers 2024-2043. Simplified 宜忌 based on day branch (地支).
Solar terms use approximate dates.