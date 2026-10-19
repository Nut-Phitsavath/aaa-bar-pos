# Test case checklist — on the device

One list per row of [test-case.md](test-case.md), in the words the screens actually use.

`npm run check:flows` already proves the server side of every row below (43 assertions, on a throwaway bill it deletes afterwards). What it cannot see is the tablet in someone's hand and the paper coming out of a printer, which is what this list is for — and it is the list to walk the owner through at sign-off.

## Before any of it

- [ ] A shift is open (Shifts → open, needs a manager PIN). Nothing sells with the night closed.
- [ ] At least two waiters exist and are active (Users → role Waiter). TC-ORD-002 and TC-ORD-004 need two.
- [ ] Settings → Docket printers holds the bar and kitchen addresses, e.g. `192.168.1.50` (port 9100 is assumed).
- [ ] Menu → each category shows the right station badge, Bar or Kitchen. Snacks is Kitchen; everything else ships as Bar.
- [ ] Two devices if you can — one till, one tablet. Several rows are about two people working one table.

---

## TC-ORD-001 — Modifiers and a preparation note

- [ ] Floor plan → tap a free table. The POS opens into that bill.
- [ ] Pick a waiter in the banner at the top.
- [ ] Tap a cocktail. It lands in the cart on the tap — no dialog, by design.
- [ ] Tap the cart line. The dialog opens on it.
- [ ] Type `Extra Mint & Less Ice` in the note field, confirm.
- [ ] Cart line shows the note under the name, and the price is the menu price.
- [ ] Send → the table. The note is on the round in the ticket panel.

Two deviations to say out loud before the owner ticks this:

- [ ] **Size.** There is no size axis. A bar names the serving in the item — "Beer Lao Bucket (5)", "Whisky (glass)". If they want `Mojito L`, it is a menu item, not a modifier.
- [ ] **Sweetness.** The 50% / 75% chips only appear if that category has Sugar switched on (Menu → category → edit → Sugar). No bar category has it on today. Switch it on for Cocktails if the owner wants it, then re-run this row.

## TC-ORD-002 — Two waiters, one table

- [ ] Device A: open table T-04, pick waiter Kham, key 2 beers, Send.
- [ ] Device B (or the same till, waiter swapped): open T-04, pick waiter Nok, key 1 snack, Send.
- [ ] The ticket shows two rounds, `#1` and `#2`, each headed by its own waiter's name.
- [ ] Both rounds are on the one bill and the running total covers both.
- [ ] Device A refreshes within about five seconds and shows B's round without a reload.
- [ ] Try Send with no waiter picked: it refuses and says to pick one.
- [ ] Reports → Server / staff shows the round against the right waiter, not against whoever was logged in.

## TC-ORD-003 — Void one line, with a reason

- [ ] On a sent round, tap **Void item** on the steak line.
- [ ] The dialog will not submit with no reason picked. Confirm that.
- [ ] Pick `Customer changed`, add a note, submit.
- [ ] The line stays visible on the ticket, struck through, and names who voided it.
- [ ] The bill total drops by exactly that line.
- [ ] Inventory → that item's stock has gone back up by the recipe amount.
- [ ] Reports → **Void audit** lists it with table, round, item, value, waiter, who struck it, reason and note.
- [ ] Void every line of a round and the round reads as cancelled rather than as an empty round.

## TC-ORD-004 — Duplicate order

- [ ] Device A: send 2 of the same drink to table D-06.
- [ ] Device B, within five minutes: put the same drink in the cart and press Send.
- [ ] A dialog stops it — "This table was already served this" — naming the drink, the other server and how long ago.
- [ ] **Cancel** leaves the cart alone and sends nothing.
- [ ] **Send anyway** sends it, for the genuine second round.
- [ ] Send the duplicate on purpose, then **Void item** → reason `Duplicate order`.
- [ ] Customer is not charged: the bill total is back where it was.
- [ ] Reports → Void audit shows it, and the by-reason breakdown counts it under Duplicate.
- [ ] Same drink, 30 minutes later: no warning. A thirsty table is not a duplicate.

No manager PIN on this, by your decision on 19 Sep 2026: every void carries a name and lands in the void report. Confirm the owner still wants it that way when they sign this row off.

## TC-EXC-001 — Exchange down (nothing charged)

- [ ] Order a package (a Set) onto a table and Send.
- [ ] Tap **Exchange** on the package line.
- [ ] Take out the higher-value contents, put in the cheaper replacement.
- [ ] The dialog shows the charge as **0** before you confirm, and both values.
- [ ] Confirm. The bill total does not move — the package price stands.
- [ ] The package line now reads what it actually delivered, out and in.
- [ ] Inventory: what came out went back on the shelf; what went in came off it, same quantities.
- [ ] Try taking items out with nothing in return: refused (that is a restock, not an exchange).
- [ ] Try taking out more than the package holds: refused.

## TC-EXC-002 — Exchange up (difference charged)

- [ ] On the same package, exchange something cheap for something dearer.
- [ ] The dialog shows the difference before you confirm, and it matches menu price × quantity both ways.
- [ ] Confirm. A separate line — *Exchange difference* — appears on the bill for exactly that amount.
- [ ] The bill total rises by the difference and nothing else.
- [ ] Undo the swap: the charge line is struck and the stock movement reverses both ways.
- [ ] Settle the bill. The receipt shows the difference as its own line, not folded into the package price.

## TC-EXC-003 — Exchange audit trail

- [ ] Reports → **Exchanges**, with today in the date range.
- [ ] Both swaps from the rows above are listed, newest first.
- [ ] Each row names table, staff, package, what went out, what came in, the difference and the time.
- [ ] The staff breakdown totals the value each person sent back to the shelf.
- [ ] A reversed swap still appears, marked reversed — it does not vanish.

## TC-REST-001 — Restock what was never opened

- [ ] With the table's bill open, tap **Settle bill**, then **Return unopened** on the settle screen.
- [ ] The list offers only what this table still holds — package contents included, exchanges already netted off.
- [ ] Enter 4 unopened Heineken, submit.
- [ ] Inventory: Heineken stock is up by 4.
- [ ] The bill total does not move. The bar keeps the money; only the count changes.
- [ ] Open the dialog again: those 4 are gone from what is left, so nobody can hand them back twice.
- [ ] Reports → the returned-unopened figures include tonight's count.

## TC-REST-002 — Restock validation

- [ ] Open a bill holding only Beer Lao and water.
- [ ] **Settle bill** → **Return unopened**. Winecooler is not on the list at all — it cannot be picked.
- [ ] That structural block is the real control; the API refuses it too, which `check:flows` proves.
- [ ] Try a quantity above what the table had: refused.
- [ ] Try a fractional quantity: refused.

## TC-ORD-005 — Kitchen and bar routing

- [ ] Both printers powered, on the LAN, addresses in Settings → Docket printers.
- [ ] Key one food item and two drinks onto a table in the same round. Send.
- [ ] Kitchen printer prints the food only. Bar printer prints the drinks only. Both within a second or two.
- [ ] Each docket's first line is the station, second the table and round number, third the waiter and time.
- [ ] A preparation note prints under its line, marked `**`.
- [ ] Paper cuts itself; nothing is chopped off the right edge.
- [ ] Lao text is legible. If it prints as noise, that is the printer's codepage — say so and we set it in `lib/dockets.ts`.
- [ ] Send a drinks-only round: the kitchen gets no paper at all.
- [ ] Unplug the kitchen printer's network cable and send a food round. The round still saves, and the till warns "KITCHEN: printer not answering".
- [ ] Plug it back in and send again: it prints.

Walk-in counter sales do not print dockets — they are made in front of the customer and already print a receipt. Say so if the owner asks.

---

## When the list is clean

- [ ] `npm test` — 385 pass.
- [ ] `npm run check:flows` — all flows pass, against the machine the bar will actually run on.
- [ ] test-case.md statuses match what you saw on the device.
