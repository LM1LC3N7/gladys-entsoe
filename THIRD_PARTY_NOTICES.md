# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below.

## JaccoR/hass-entso-e

<https://github.com/JaccoR/hass-entso-e> (read at commit `cbdf67a`,
2026-02-16)

Copyright JaccoR and the hass-entso-e contributors. Licensed under the Apache
License, Version 2.0, the same license as this integration: its full text is
the `LICENSE` file of this repository, and at
<http://www.apache.org/licenses/LICENSE-2.0>. The project ships no `NOTICE`
file.

Ported to JavaScript, and changed (Apache-2.0, section 4 b):

- `src/entsoe.js`: the A44 request (`documentType`, `in_Domain`,
  `out_Domain`, `periodStart`, `periodEnd`, `securityToken`) and the reading
  of the answer from `custom_components/entsoe/api_client.py` — the PT15M /
  PT60M periods, a missing position repeating the previous price, the series
  of classification sequence 1 kept first where two overlap. Changed: a
  linear, bounded scanner instead of `xml.etree`, overlaps decided per period
  span, the positions after the last point filled up to the end of the
  period (curve A03), unreadable points refusing their period, the "no
  matching data" acknowledgement recognised, no averaging to another
  resolution.
- `src/constants.js`: the list of bidding zones and their EIC codes, from
  `AREA_INFO` (`const.py`) and `Area` (`api_client.py`).

None of the code is copied verbatim; no test dataset of the project is
included.
