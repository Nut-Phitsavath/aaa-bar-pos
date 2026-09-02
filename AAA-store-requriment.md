Table Management	Visual Floor Plan & Table Maps	Interactive layout showing indoor, outdoor, VIP rooms with live status (Free, Occupied, Bill Requested).	SambaPOS4 Streamlined Core	Must Have
Table Management	Table Operations (Split/Merge/Transfer)	Ability to split bills by item, merge tables together, or transfer items/tables.	SambaPOS4 Streamlined Core	Must Have
Table Management	Bill Timestamp Metadata	Print and display Table Name, Walk-in Open Timestamp, and Table Checkout Close Timestamp on every bill.	Custom Lao VIP Requirement	Must Have
Order & Menu	Streamlined Web Menu & Modifiers	Touch-friendly categories, sub-items, portion sizes, and custom preparation notes (e.g., No MSG, Extra Spicy).	SambaPOS4 Streamlined Core	Must Have
Order & Menu	Order Cancellation & Void Audit Log	Handling duplicate orders (e.g. 2 staff keying same table). Requires mandatory void reason selection. Keeps complete audit history of all cancelled orders.	Custom Lao VIP Requirement	Must Have
Order & Menu	Assign each order to a waiter	"Instead of login, use assign to waiter as a way to make report of the waiter performance, how much he had sold, orders, etc. 
One table can have many waiter, if the waiter take order from any table assign them to that table for that set of order only, new order for the table can be for other waiter
"	SambaPOS4	Must Have
Order & Menu	1 table can have many Payment methods	"Ex: pay cash first 500,000 kips
The test 1,000,000 pay using OnePay
"	SambaPOS4 + BCEL OnePay	Must Have
Item Exchange	Package Item Exchange Engine	Dedicated button on Table View allowing staff to swap package items (e.g., 15 Winecooler, 2 beer lao, for 4 Water). If Src >= Target price, 0 extra charge & retain profit. If Src < Target price, charge customer price difference.	Custom Lao VIP Requirement	High
Item Exchange	Item Exchange Audit Log	Log all item swap events attached to that specific table session (Who exchanged, items, price difference, timestamp).	Custom Lao VIP Requirement	High
Item Exchange	Unconsumed Package Drink Restock	Upon table cleanup, staff count unopened/unconsumed drinks left at table. Staff input count via Table View to restock physical inventory. Restock restricted ONLY to items ordered on that table's cart.	Custom Lao VIP Requirement	High
Discounts & VIP	Per-Table Discount (% & Fixed Amount)	Apply discount per table bill either by percentage (%) or fixed THB amount. Percentage discount rounds up (e.g. 2,499.5 THB -> 2,500 THB).	Custom Lao VIP Requirement	Must Have
Discounts & VIP	Owner VIP / Eat Free Table Setting	Special Owner VIP mode. Deducts physical inventory stock for ordered items, but sets total bill payable amount to 0 THB (Logged under Owner VIP Comped Account).	Custom Lao VIP Requirement	Must Have
Payment & Currency	Main THB & Multi-Currency Bill Display	Main currency is THB. Bill displays total in THB, with converted LAK (Lao Kip) and Exchange Rate at bottom. Toggle in settings to display USD equivalent.	Custom Lao VIP Requirement	Must Have
Payment & Currency	Historical Exchange Rate Integrity	Exchange rates configured in settings. Changing rates today MUST NOT retroactively modify past closed bills or historical sales reports. Rates are locked per transaction.	Custom Lao VIP Requirement	Must Have
Payment & Currency	Flexible Payment (Pay Front vs Pay Later)	Support Pay-at-Front (immediate checkout via Cash/BCEL QR) and Pay-Later (VIP tab / House account deferred payment settled post-shift).	Custom Lao VIP Requirement	Must Have
Payment & Currency	BCEL OnePay API Integration	Generate dynamic BCEL OnePay QR code on screen for exact bill total. Webhook automatically verifies payment, completes ticket, and prints receipt.	Custom Lao VIP Requirement	Must Have
Inventory & Audit	Recipe-Linked Inventory Deduction	Recipe link deducts raw ingredients and packaged goods (e.g. 1 Heineken Set = 50 bottles deducted) automatically upon order.	SambaPOS4 Streamlined Core	Must Have
Inventory & Audit	Print Inventory Audit Sheet	Provide a 'Print Inventory Audit Sheet' button for Head Inventory Manager to print physical stock checklist per shift to quickly spot unkeyed/missing items.	Custom Lao VIP Requirement	High
Reports & Performance	Individual Staff / Waiter Performance & Shift Report	Detailed report per staff member per shift (Total sales processed, tables served, voids/cancellations count, discounts given).	Custom Lao VIP Requirement	High
Reports & Performance	Cancelled Orders & Void Audit Report	Dedicated manager report listing all cancelled/voided items, staff name, table, time, and void reason.	Custom Lao VIP Requirement	Must Have
Reports & Performance	Daily Z-Report & Cash Reconciliation	End-of-day summary breaking down sales by payment method (Cash, BCEL QR, Pay Later VIP Tab, Owner VIP Comped).	SambaPOS4 Streamlined Core	Must Have
Server & Hardware	Database must be able to use for 3 devices	"They have total of 3 devices, 1 use as main the rest access that one
Might need dedicated server for this"	SambaPOS4 Streamlined Core	Must Have