# Remaining brand catalog refresh — 2026-09-11

Reviewed all 459 active body/lens products from Blackmagic Design, Hasselblad, Leica, OM SYSTEM, Olympus, Panasonic, Pentax, Ricoh, Samyang, Sigma and Tamron.

- Replaced 456 product mappings using 382 distinct manufacturer/official distributor originals. Exact model identity and cutouts were visually reviewed; transparent margins and object scale were normalized. Original pixels were retained with local background masks. 44 mappings retain lower-resolution originals, as recorded in the image audit.
- Removed three incorrect photos and explicitly show “이미지 준비 중”: Olympus M.Zuiko Digital 14-42mm F3.5-5.6 II, Panasonic LUMIX G VARIO 14-42mm F3.5-5.6 ASPH. MEGA O.I.S., and Panasonic LUMIX GF8. Final replacement acquisition was blocked by automatic approval review without a detailed reason. No substitute model is shown.
- Reviewed 557 price rows, including inactive historical entries: 172 verified current official prices, 19 Korean launch prices, 3 historical official prices, 359 unconfirmed prices, and 4 previous prices requiring reconfirmation. Historical and unverified records retain distinct labels. Unconfirmed rows do not display invented numeric prices.
- Exact mount and body-versus-kit configuration were checked. Sources include Korean manufacturer stores/notices, Saeki, Tamron's official Korean distributor, Samyang's official store, Leica Korea and Hasselblad Korea. Each confirmed price includes its source URL and verification date in the JSON audit.
- Existing Sony, Canon, Nikon and Fujifilm price records were preserved byte-equivalently as parsed rows. This completes the remaining brands after the earlier four-brand refresh.

The same image mappings and prices feed ordinary body/lens catalogs, product details, and the builder index. Manufacturer ordering and DSLR visibility remain covered by existing regression checks.

Validation: all imported image files have transparent and opaque alpha pixels; all 459 active products have reviewed images or explicit placeholders. Catalog/index parity, mount-specific prices, body-only configuration, price detail rendering, visibility, manufacturer order, admin integration, programs and homepage checks passed. Detailed records are in `remaining-brand-image-refresh-20260911.json` and `remaining-brand-price-refresh-20260911.json`.
