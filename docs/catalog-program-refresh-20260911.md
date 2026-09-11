# Catalog and program refresh — 2026-09-11

## Delivered behavior

- Filename export at `/program/filename/`: extension-free filename watermark, white/black, three bottom presets and click/drag/keyboard custom positions, relative font/margin controls, local batch processing, JPEG downloads and ZIP. Each JPEG is capped at 5,000,000 bytes; quality and then dimensions are reduced as needed. Originals stay untouched. Reference: `D:/Program/PhotoProgram_Caffa/PhotoProgram_Caffa.py`.
- Resize/equipment-watermark program card no longer says beta. The separate RAW rating tool retains its beta label.
- Compatibility badges keep their intrinsic height beside wrapped descriptions. Existing cross-brand thread and plate compatibility rules remain covered by tests.
- Tripod/head loaders exclude missing, non-numeric, zero and negative payloads and inactive records, including cached reads and estimate URL hydration.
- Accessory listings and estimate selections use local reviewed product photographs. Series representative flash/adapter images are explicitly labelled in the accessory listing.

## Catalog coverage and provenance

The support catalog grew from 16 tripod and 9 head records to 151 tripod and 53 head records. Public listings contain **148 tripods and 52 heads**. The four records without confirmed load capacity remain in source data for future review but do not appear in public lists or estimates: Leofoto LSR-324C/LH-40 kit, Benro TTOR34C legs, SLIK PRO 700 DX legs and SIRUI K-20X head.

All 200 public support products have local photos, as do all 17 mount adapters, 16 batteries, 12 flashes, 8 memory cards and 6 plates. New reviewed image directories total approximately 4 MB. Exact image URLs, source pages and review dates are stored on records. Two retired products (Olympus MMF-3 and Velbon Sherpa 635 III N) use exact-model retailer images. Godox V1Pro mount variants and Sigma MC-21 SA use labelled series images. Sony CEA-G160T uses a manually verified crop of the 160GB card from Sony's two-card press photograph. The Manfrotto PIXI EVO red SKU now uses the red manufacturer's photo.

Domestic sale and price sources include Saeki, KPP, Benro Korea, Sunphoto, Takecompany, PhotoClam Korea, Vanguard Korea and Peak Design's Korean distributor. Product records distinguish Korean manufacturer/distributor prices from retailer displayed prices; these are not all launch prices. Source URLs and dates are attached. Kit payload is limited by its included head, rather than copying a larger legs-only figure. Unknown attachment standards remain unknown.

Manufacturer specifications were supplemented on **596 body/lens records**, with **6,398 field-level source entries** across Sony, Canon, Nikon, Fujifilm, Sigma, Tamron, Panasonic, Olympus/OM SYSTEM, Pentax, Ricoh and Leica. Source text is retained where a concise translation could lose operating conditions. Sensor dimensions are distinguished from sensor type. Fuji nested-table exposure rows are excluded from movie specifications; Korean `만`/`억` pixel units are normalized. Canon EOS R5 Mark II now includes verified battery, dimensions, weight, card slots, sensor and connection details. Its official PDF contains inconsistent copied rows on later pages; the conflicting rows were not used.

This is a verified expansion, **not a claim that every historically sold Korean model or every specification is known**. Smaller/discontinued brands and some complex video matrices still have unconfirmed fields, displayed as `공식 정보 미확인`. Products without reliable load data are intentionally excluded as requested. Domestic kits with uncertain included heads, PhotoClam title/table discrepancies, and SmallRig TRIBEX II conflicting payload statements were not added. No guessed specifications or converted overseas prices were substituted.

## Validation

- Existing admin, public catalog visibility, manufacturer filter order, price details, remaining catalog, support compatibility, battery compatibility, program and homepage checks passed.
- New support visibility test verifies invalid loads, disabled products, cached reads, public counts and every referenced local support image.
- New specification regression test checks source provenance, Canon details, Korean megapixel units and Fuji table-section mistakes.
- Chrome browser test verifies white/black text, preset/custom positions, unique filenames, batch export, ZIP, reset, output invalidation and mobile overflow. A noisy 4096-square fixture exported at 4,881,629 bytes.
- Chrome integration review verifies 19.2px compatibility badges, the added SmallRig kit's 1,189,900 KRW estimate line, support counts, loaded support photos, Canon comparison fields and mobile width. Contact sheets and program/compatibility/compare screenshots were visually inspected.

Research collectors/importers are maintenance tools, not part of runtime or automatic deployment. Their temporary caches are excluded from Git. Re-running a collector/importer requires renewed source and configuration review; do not overwrite later manual corrections blindly. The checked-in product metadata is the audit trail for the published snapshot. Existing `design/` draft assets are outside this change.
