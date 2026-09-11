# Site quality review — 2026-09-11

## Changes

- Missing camera/lens mounts and missing sensor coverage no longer produce a successful compatibility result. A same-mount result describes mount/format evidence, not guaranteed AF/electronic behavior. Adapter results name the adapter, AF/aperture status and model/firmware confirmation requirement; disabled adapters are excluded.
- Missing body, lens, flash, plate or separately selected head weights no longer become zero in the support payload. All selected lens weights must be known before choosing the heaviest mounted lens. Spare equipment is not counted as simultaneously mounted. A missing payload blocks a load grade. Total weight retains its incomplete marker and no longer treats null values as measured zero.
- Catalog and estimate cards cannot fall back from Korean prices to a USD number formatted in KRW.
- An unselected comparison column now says to select a product, instead of claiming its specifications are unverified. Body-search placeholder uses neutral product/model wording.
- Estimate layout fits intermediate desktop widths and accessory filters fit mobile screens.
- Existing admin DB review expanded to include accessories, missing core specifications, image placeholders, missing source evidence, invalid dates, 180-day price/spec review flags, missing support loads and kit/head load contradictions. Historic launch prices do not expire. Cross-mount model variants are not treated as duplicate models.
- Admin review has visibility/severity/type/search filters, counts, complete pagination instead of a 500-row cutoff, JSON download and direct links to the relevant product, price, photo or accessory editor. Review is read-only until the user uses the existing explicit save/deploy controls.

## Inventory findings

`node scripts/audit_catalog_snapshot.mjs` generates the full local report in ignored `tmp/site-review.json`. Source record counts can include duplicate records merged by the public catalog; issue totals are not counts of confirmed factual errors.

Active source-record findings: 569 specification gaps, 474 unconfirmed prices, 54 missing source-evidence flags, 2 price-date review flags, 3 image placeholders and 45 same-mount model-code review flags. These can overlap and include legitimate series/code reuse. No referenced local image files are missing. Four missing-load source products remain hidden as previously requested. No active kit/head load contradictions or duplicate IDs were found.

This pass does not invent missing prices/specifications or treat a syntactically valid URL as a successfully visited source. URL reachability and exact model photographs still require source research. The three remaining image placeholders are Panasonic GF8, Panasonic H-FS014042 and Olympus M.Zuiko 14–42mm II (not II R). Those known research gaps remain visible in the review queue.

## Validation

- Existing worker/admin, catalog visibility and filter order, price details, support/battery compatibility, program and specification regression checks passed.
- New quality tests cover missing mounts/formats/weights, heaviest-lens composition, head mass, hidden adapters, pixel-less focal ranges, cross-mount duplicates, placeholder photos, launch-price age and malformed dates.
- Admin browser verification uses local mocked API responses only: correct image/accessory editors, filters, full pagination and filtered JSON download passed. No production admin data was mutated by tests.
- Ten public routes checked at desktop and mobile widths; no uncaught browser errors or page overflow after fixes. Home search, body/lens search, details and estimate transfer passed.
- Eleven estimate breakpoints and all seven accessory categories passed responsive checks.
- Existing filename browser export test, resize preview test and catalog comparison/estimate test passed.

Draft `design/` assets remain untouched. New tests and maintenance reports do not publish catalog edits automatically.
