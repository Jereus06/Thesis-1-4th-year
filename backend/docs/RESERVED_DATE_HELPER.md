# Reserved groupmate task: ISO date helper

The standalone helper below and its dedicated unit tests are intentionally **not implemented** in
this migration:

```python
def is_valid_iso_date(value: str) -> bool: ...
```

Contract:

- accept only `YYYY-MM-DD` strings;
- reject impossible calendar dates such as `2026-02-30`;
- implement Gregorian leap-year rules (`2024-02-29` valid, `2100-02-29` invalid);
- reject timestamps, alternate separators, whitespace variants, and non-zero-padded dates.

Integration point: CSV import preview should call the helper before converting a raw Date column.
Until the reserved task lands, runnable API request models use Pydantic/Python `date` validation,
which already rejects invalid calendar dates. Do not add a placeholder that always returns true.
