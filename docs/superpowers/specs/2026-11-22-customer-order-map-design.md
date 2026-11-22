# Customer order map (slice 4 UX)

**Status:** approved  
**Date:** 2026-11-22

## Intent

Customers pick seats on a spatial map. They only see buyable-here vs not available (plus optional Ticket2Me link-outs). First and second choice are clear, qty-capped steps above the map.

## Behaviour

- Full venue grid (`grid_row` / `position`); aisle gaps as empty cells.
- Preferred section sets price; only that section’s conflict-free `direct_buy` seats are selectable.
- **Available here** — pickable. **Buy on Ticket2Me** — opens event URL (when shown). **Not available** — one muted look (house/sold/hold/conflict/other).
- Checkbox “Hide seats still on Ticket2Me” **on by default** — those seats render as not available / non-linkable.
- First / Second choice controls **above** the map: First active = black; Second active = teal. Map fills: first-choice seats teal, second-choice violet.
- Each choice stops at qty; tap to deselect. Progress `n of qty`. No silent rotation.
- Submit requires both choices exactly `qty` seats (unchanged server contract).
