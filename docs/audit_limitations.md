# CS053 Report — Audit / Ownership Limitations

**Audience:** Spencer dev team inheriting the Dalux Report Portal.

**Context:** this document explains a known limitation in how the CS053 Weekly Safety Inspection PDF attributes row-level ownership. Read it before changing the `owner-chip` rendering in [backend/app/reports/templates/cs053.html.j2](../backend/app/reports/templates/cs053.html.j2) or the attribution logic in [backend/app/reports/cs053.py](../backend/app/reports/cs053.py).

## The limitation

Every row in the generated CS053 PDF shows the **form submitter's initials** in the owner chip, not the initials of the user who actually ticked (or modified) that specific row.

```
1.1  Site boundary and signage          [ Green ]  [ NCW ]   ← these initials are the
1.2  Welfare facilities                  [ Green ]  [ NCW ]     form submitter on every
1.3  First-aid provision                 [ Red   ]  [ NCW ]     row, regardless of who
                                                                edited the individual row.
```

If two inspectors co-signed the inspection — e.g. the supervisor ticked items 1.1–1.5, the safety officer ticked 1.6 onwards — the PDF cannot distinguish them. Both rows will show the submitter's initials.

## Why

Dalux **does** capture per-field change history server-side. You can see it in the Dalux web UI as an audit trail on each field. That history is **not pulled** by the current n8n → MariaDB sync, so it never reaches this application.

What the sync gives us per form:
- `DLX_2_forms.createdBy_userId` — who originally submitted the form
- `DLX_2_forms.modifiedBy_userId` — who last touched the form as a whole
- `DLX_2_form_udfs` rows — current value of each field, but **no history of edits**

What the sync does **not** give us:
- A per-field `modifiedBy` / `modifiedAt`
- Any row-level change log tying a specific user to a specific field mutation

Because there is no per-field attribution in our data warehouse, the report renderer has no choice but to attribute every row to the form-level submitter (or the `inspector_uid` from the `Inspection By` UDF when present — see [`cs053.py:138`](../backend/app/reports/cs053.py#L138)).

## Why this matters for audit

For single-inspector inspections, the current behaviour is accurate — one person filled everything, their initials on every row is correct.

For co-signed or multi-inspector inspections, the PDF under-represents reality. It cannot be used as standalone evidence of *who* marked a specific non-conformance. If that attribution is needed for an incident investigation, the source-of-truth is the Dalux audit trail in the web UI, not this PDF.

## User-facing copy

An earlier version of the PDF included an "Audit note" banner on page 1 explaining this caveat to end users. That banner was **removed in v3.2** because it caused more confusion than clarity — inspectors reading their own reports flagged the banner as implying the report was unreliable in general. The limitation is now documented here for the dev team only.

Cross-reference: **Tech debt #2** in [DALUX_PROJECT_SCOPE_v3.2.md](DALUX_PROJECT_SCOPE_v3.2.md).

## If you want to fix this

Two routes:

1. **Extend the n8n sync** to pull Dalux's per-field change history into a new table (e.g. `DLX_2_form_udf_changes`) keyed by `(formId, field_key, timestamp, userId, action)`. Then in `cs053.py`, look up the most recent change per `field_key` and emit those initials in the owner chip. This is the correct fix.

2. **Document the single-inspector assumption explicitly.** If Spencer's process actually guarantees one inspector per form, this limitation is moot and worth stating as an invariant rather than a caveat.

Do not try to infer per-row ownership from `modifiedBy_userId` alone — that only tells you who last touched the form overall, which is almost always identical to the submitter for same-day inspections and will mis-attribute if anyone edits the form later for housekeeping reasons.
