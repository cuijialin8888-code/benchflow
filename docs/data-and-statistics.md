# Data and statistics contract

## Records

Version-1 backups contain `version`, `projects`, `experiments`, `runs`, and `notes`. Every record has an ID and creation/update timestamps. Experiment/project references must exist. IDs are unique within each collection. Run points are `{x, y}` numbers with strictly increasing, unique X values.

| Limit | Value |
| --- | --- |
| Projects | 100 |
| Experiments | 500 |
| Runs | 2,000 |
| Notes | 1,000 |
| Points per run / CSV data rows | 10,000 |
| Total points | 200,000 |
| CSV file size | 10 MB |
| Backup input size | 30 MB |
| Numeric magnitude | Absolute value ≤ 1e12 |

The browser checks input file byte size before reading; parsers also cap string length. Storage quotas vary by browser. A workspace below these limits may still exceed a device's quota; failed saves show an error and preserve the last committed snapshot. Export regularly.

## CSV import

- UTF-8 with an optional BOM; comma, semicolon or tab selected explicitly.
- 2–100 unique nonblank column headers; at least one nonblank data record.
- Quoted fields can contain separators, line breaks and doubled quotes. Ragged rows or invalid quote syntax are rejected. Completely blank records are skipped.
- Two different selected columns must contain finite decimal numbers. Scientific notation is supported. Decimal commas, unit suffixes, hexadecimal, missing values, NaN and Infinity are rejected.
- Rows are sorted by numeric X. Equal numeric X values (including `1` and `1.0`) are rejected rather than averaged.
- Each import creates one run or replaces the curve in an existing run after explicit confirmation. Imports mark that run complete. Names and units are not inferred or converted from numeric values.

## Group summaries

For each exact group name and exact numeric X, collect one Y per selected run that contains that X:

`mean = Σ yᵢ / n`

`sample SD = sqrt(Σ (yᵢ − mean)² / (n − 1))`, for `n ≥ 2`.

The implementation uses Welford's numerically stable online update for mean and squared deviations. SD is `null` for one observation and displayed as `—`; it is never replaced with a made-up zero. Error bars show ± one sample SD, not standard error or a confidence interval.

No interpolation, rounding to a common grid or nearest-neighbor alignment occurs. `0.3` and a computed floating-point value slightly above `0.3` can be distinct X values. Missing time points yield varying n. The user is responsible for compatible units, appropriate group assignment and experimental independence. Group statistics do not establish causality or significance.

Individual run area is `Σ (xᵢ − xᵢ₋₁)(yᵢ + yᵢ₋₁)/2`. It is a signed trapezoidal integral over the available X interval; no baseline subtraction or extrapolation occurs. With fewer than two points, area is undefined. Min/max/last Y are descriptive values.

## Export semantics

- **JSON backup:** complete, lossless application records using JSON's number representation; preferred for restoration. The app validates all relationships before replacement.
- **Measurements CSV:** one row per point with `run,sample,group,status,x,y`; exports the whole active experiment, independent of the current run-list search filter. Axis labels/units live in the experiment and JSON backup; CSV uses generic X/Y headers.
- **Summary CSV:** group, X, n, mean and sample SD for the current analysis selection. Undefined SD is blank. Exact numeric values are exported rather than rounded table strings.
- **SVG:** current plotted selection and mode, axis labels/units, experiment title and group legend. Individual curve names appear in SVG tooltips. Group labels longer than 30 characters are shortened visually with the full label in a tooltip. Display sampling applies to SVG export as well as the on-screen plot.
- **Spreadsheet protection:** textual CSV cells starting with whitespace and `=`, `+`, `-` or `@` are prefixed with an apostrophe. Numeric negative values remain numbers. CSV exports are not the exact restoration format.

## Provenance

The app preserves numeric observations and explicit notes but does not retain an immutable import log or source-file hash. It is not an auditable evidence repository. A user can edit a JSON backup and re-import valid records. Use appropriate external provenance and access controls where required.
