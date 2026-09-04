# Dialed Offroad 3.0 mockup pack: Home and Garage

These HTML files are the visual source of truth for the Home and Garage rebuild. Open any file in a browser to view it at phone size. `dialed.css` holds every color, type size, radius and spacing value; lift values from it rather than guessing.

| File | Screen | Spec section |
|---|---|---|
| 01-home-established.html | Home, established rider, full scroll (above and below the fold) | Home, established state |
| 02-home-day-one.html | Home, brand-new rider (day one), full scroll with empty states | Home, day-one state |
| 03-garage-bike-list.html | Garage bike list (only rendered with 2+ bikes) | Garage, list |
| 04-garage-bike-page.html | Per-bike page: identity, meter, hours, tires, setups, story card, coming rows | Garage, bike page |
| 05-setup-sheet.html | Setup detail (the clicker sheet), one row expanded | Garage, setup detail |
| 06-setup-history.html | Full setup story view with circuit chips, graph, version timeline | Garage, history |
| 07-setup-secondary-dunes.html | A non-running setup page with deltas vs the running setup | Garage, secondary setup |

Rules the mockups encode:
- Barlow Condensed Black Italic for headings only. All numeric values are Inter 700 at 26 to 34pt (regular width, not condensed).
- Single blue accent (#1D9BF0) means selected, primary, or active. Brand colors are edge stripes and eyebrows only.
- Muted steel glyphs on rows; a glyph lights blue only on the expanded or active row.
- No blur anywhere. Locked content is crisp rows with a lock glyph.
- The setup sheet shows numbers only when collapsed: no stock ticks, no deltas vs stock, no steppers. Expanding a row shows a range bar (only when the model's total click range is known), end labels, "What it does", "Why N for you", history line, and a tap-to-fix.
- Home never shows anything the app cannot know: no weather, no conditions, no notifications tied to next ride.
- Tabler Icons webfont is used for glyphs; substitute the app's icon set 1:1.
