# ModelGuard limitations

ModelGuard is a deterministic review aid, not a workbook calculation engine or professional
accounting opinion. Formula results are the workbook's cached values; missing cached results are
reported rather than invented. Some Excel features may be represented as warnings or metadata and
require review in a desktop spreadsheet application.

The current parser supports ordinary `.xlsx` files and intentionally refuses to execute macros,
follow external links, or call a remote recalculation service. It does not validate every accounting
policy, tax treatment, sign convention, scenario definition, or investment conclusion. A clean
report means no current rule fired; it is not a guarantee that the model is correct.
