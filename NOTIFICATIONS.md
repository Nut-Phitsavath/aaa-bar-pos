# Notifications — how the POS talks back

How this app tells the cashier something. Read this before adding any new message.

There is exactly one rule that matters: **`window.alert` and `window.confirm` are
banned.** They freeze the whole tab, can't be styled, and render their buttons in
the browser's language — so a Lao POS ends up showing English `OK` / `Cancel`
chrome nobody asked for. All 59 of them were removed in `fix/replace-browser-popups`.

---

## Which one do I use?

Ask one question: **does the user have to answer before anything else can happen?**

| | Use | Why |
|---|---|---|
| No — just tell them | **Toast** — `notify.*` | Doesn't interrupt. The cashier keeps serving. |
| Yes — and getting it wrong destroys data | **Confirm dialog** — `useConfirm()` | Blocking is the point. Make them decide. |
| The problem is *in a field they're filling* | **Inline error next to the field** | A toast about field 3 makes them hunt for field 3. |

A modal the cashier must dismiss to keep serving a customer is a tax on every
order. If you're reaching for the confirm dialog for anything other than
destroying data, you probably want a toast.

---

## Toasts

```ts
import { notify } from "@/components/ui/sonner"

notify.success(t.deposited_successfully, { description: `${qty} ${unit} — ${name}` })
notify.error(t.deposit_failed, { description: error.error || t.unknown_error })
notify.warn(t.enter_valid_quantity)
notify.info(t.synchronizing)
```

`message` is the headline — what happened. `description` is the detail —
which item, which amount, what the server said. Put the *variable* part in
`description`, never build a sentence by concatenating a translation key with
data; Lao word order won't survive it.

### The four types

Pick by **what the cashier does next**, not by how bad it feels.

| Type | Colour | Use when | Example in this codebase |
|---|---|---|---|
| `success` | emerald | The thing they asked for is done | stock deposited, settings saved, transfer complete |
| `error` | rose | It failed. The sale can't continue as-is | BCEL down, order create failed, shift won't close |
| `warn` | amber | They must fix an input before this will work | no quantity entered, not enough points, no reason given |
| `info` | slate | Neutral status, nothing to act on | syncing |

`warn` is not "a mild error" — it means **the user can fix this right now**.
`error` means something outside their control broke. That distinction is why
`enter_valid_quantity` is a warn and `deposit_failed` is an error.

### Durations

Set centrally in `components/ui/sonner.tsx`, not per call.

**Errors do not time out.** A timed error is a message you can miss by looking
down at the counter, and the cost of missing "payment failed" is handing over
goods unpaid. It stays until dismissed.

| Type | Duration | Reasoning |
|---|---|---|
| success | 3500 ms | A missed "saved" costs nothing |
| info | 4000 ms | Nothing to act on |
| warn | 6000 ms | Self-correcting — they fix the field and move on. 6s not 5s because Lao takes a moment longer to read |
| error | **until dismissed** | They have to read it and choose what to do instead |

Everything except errors clears itself on purpose. A toast per sale that had to
be tapped away would be a tax on every order, and a warning that outlives the
field it was about is just a stale message taking up one of the three slots.

Because errors persist, the close button is not decoration — it's the only way
off the screen. Keep it working (see gotchas).

### Placement

Top-centre. Deliberate: it clears the cart panel on the right and the keypad at
the bottom, so it never covers what the cashier's hands are on, and it's in the
same place every time so the eye learns where to look.

**Only three show at once** (sonner's `visibleToasts` default). A fourth queues
behind. Don't fire four toasts for one action.

---

## Confirm dialog

```tsx
const confirm = useConfirm()   // from @/components/confirm-provider

if (!(await confirm({
  title: t.delete_confirm_title,
  description: t.cannot_be_undone,
  confirmLabel: t.delete,
  destructive: true,          // red button — use for anything that deletes
}))) return
```

Promise-based on purpose, so the call site stays a one-liner and reads like the
native `confirm()` it replaced. The enclosing function must be `async`.

Every close path resolves — Escape, clicking outside, Cancel — so an awaited
`confirm()` can never leave the caller hanging.

**Reserved for destroying data.** Current legitimate uses: deleting a menu item,
an ingredient, a category, a recipe line, and wiping transaction data. That's it.

---

## Writing the message

- **Every string goes through `lib/translations.ts`** — a key in *both* `en` and
  `lo`. No literal user-facing text in a component. `useTranslation()` renders a
  missing key as `⚠️ key_name`, so a forgotten translation is loud, not silent.
- **Say what to do next, not just what broke.** "BCEL Onepay is not responding"
  is half a message; "…take cash or another payment method" is the whole one.
- **Never put raw API text on screen.** It can carry request URLs and
  credentials, and the customer-facing display mirrors this screen. Log the
  detail server-side and show the human sentence. See
  `app/api/payments/onepay/generate/route.ts`.
- **No emoji as the status signal.** The old alerts used `✅` / `❌` because they
  had no other way to show severity. The toast type carries it now.
- **Name whose fault it is when you can.** `NO_INTERNET` vs `BANK_API` exist
  precisely so the till can say "check the WiFi" instead of blaming the bank.

---

## Gotchas (all of these bit us; none show up in a green build)

- **`pointer-events` while a dialog is open.** Radix sets `pointer-events: none`
  on `<body>` for as long as a dialog is open, and the toast inherits it — the
  close button becomes unclickable and hit-testing falls straight through to the
  dialog overlay. Fixed with `!pointer-events-auto` **on the toast**, not on the
  container (the container must stay click-through so it doesn't block the UI
  behind it). Many of these toasts fire from inside a dialog, so this matters.
- **Sonner's CSS is unlayered, Tailwind's utilities are in `@layer`** —
  unlayered wins. Any override of a sonner-styled property needs `!important`
  (`!pr-14`, `!bg-emerald-50`). Without it the class is silently ignored.
- **Toast width comes from a `--width` CSS var**, not from the container's
  `width`. Setting `width` on the Toaster does nothing. The default 356px wraps
  Lao sentences to three cramped lines; we use 440px.
- **Leave a lane for the close button.** It's absolutely positioned, so without
  `!pr-14` a long Lao line runs underneath it.
- **The close button fights back if you move it.** Sonner hangs it off the
  top-left corner with `transform: translate(-35%,-35%)`, and that transform
  keeps applying on top of any repositioning — it ends up floating outside the
  toast. Kill it with `!transform-none`. But that transform was also giving the
  button its own stacking context, so once it's gone you need `!z-10` or the
  title div paints over the button and swallows the click.
- **Lao needs vertical room.** Noto Sans Lao stacks vowels and tone marks above
  and below the baseline. Keep `leading-relaxed`; a tight line-height collides
  the marks with the line above.
- **Toasts fired in `useEffect` on mount are lost.** The Toaster subscribes in
  its own effect, which runs *after* its children's. Only fire from event
  handlers or after an await — which is what real code does anyway.
- **Sonner pauses dismiss timers while the pointer is over the toaster.** A
  toast that "won't go away" may just be hovered. Harmless on the touch screens
  at the till, but it will make you doubt a duration when testing with a mouse.

---

## Adding a new message

1. Add the key to **both** `en` and `lo` in `lib/translations.ts`.
2. Pick the type from *what the cashier does next* (table above).
3. Variable data goes in `description`, not concatenated into the sentence.
4. If you're about to write `confirm()`, check it actually destroys data.
