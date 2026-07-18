---
name: react-runtime-debug
description: Debug a running React app through react-debug-mcp. Start from a CSS selector the user points at, trace the flow across the consumer app and its packages, and ground every claim in live component/Redux/network state — escalating to breakpoints or logpoints when static reading cannot settle it. Use when the user gives a selector (or names a UI element) and asks why it behaves the way it does.
---

# React Runtime Debugging

You investigate a **running** React app. The user points at a UI element — usually with a CSS
selector — and asks a question. You answer it by tracing the real flow, not by guessing from
code shape.

Your advantage over reading code is that you can see **actual runtime values**. Use it. A
diagnosis that cites an observed value beats one that cites a plausible one.

## Preconditions (you do not create these)

- Dev server is running and the page is loaded.
- Chrome is running with remote debugging enabled and `react-debug-mcp` is connected.
- `chrome-devtools-mcp` is connected (companion server — see below).

**Never** start dev servers, run builds, or open browsers. If the tools error with a connection
failure, say what is missing and stop.

## The layer model — decide this before proposing anything

The app is layered. **Which layer a bug lives in determines what you are allowed to produce.**

| Layer | Typical path | Where its real source lives | If the bug is here |
|---|---|---|---|
| **Consumer app** | `apps/import-core`, `apps/export-core` | repo working tree | **Propose a fix** |
| **`@ermis-common-ui`** | `node_modules/@ermis-common-ui/*` → the `@common-ui` repo | symlink/workspace → original `.ts` on disk | **Propose a fix** — the team owns this repo too |
| **`ids-react-components` / `ids-wc`** | symlinked into the consumer app | usually shipped `dist/` only | **Diagnose only.** State the defect precisely. Do not write a fix for it. |
| **Other third-party** (react, redux, router…) | `node_modules/*` | bundled code only | **State the issue only.** |

Two rules that follow from this:

1. **Never propose a code edit in a layer the team does not own.** For `ids-*` and other
   third-party code: state the defect exactly (file, function, why it misbehaves), then — if
   and only if one exists — propose a **workaround in a layer we do own** (consumer app or
   `@ermis-common-ui`). Label it clearly as a workaround, not a fix.
2. **When the trail enters a package, follow it in.** Do not stop at the package boundary and
   speculate. Read the package's code. How depends on the layer — see the next section.

Determine the layer by resolving the path. A symlinked package (`ls -l node_modules/<pkg>`)
points at a real source checkout, which means its **original** source is on disk and readable.

## Where to read source — do not cross the streams

This is the single most common way to waste time here.

| You want | Use | Why |
|---|---|---|
| **Original** `.ts`/`.tsx` of app or `@ermis-common-ui` | **Filesystem** (Read/Grep) | Line numbers match what `set_breakpoint` expects. |
| Original source of a **symlinked** package | **Filesystem**, through the symlink | Same as above — it's a real checkout. |
| A **third-party** package with no source on disk | `read_source` / `search_source` | These read the **bundled** code the browser is actually executing. |
| "Which bundle even contains this string?" | `search_source` | Searches all loaded bundles in parallel. |

`read_source` and `search_source` return **bundled/generated** code and **bundled line numbers**.
`set_breakpoint` takes an **original** file name and an **original** line number. So:

> **To set a breakpoint: read the file from the *filesystem*, pick the line there, and pass the
> original name.** Never feed a `search_source` line number into `set_breakpoint`.

## Tools, and when each earns its keep

### Anchor on the element (this is where you start)

- **`get_react_component_path({ selector, show_props: true })`** — **your first call.** Returns the
  ordered chain from the React root down to the element, optionally with props at each level.
  One call tells you what the component is, what owns it, and what data is flowing down. Start
  here rather than `get_component_tree`, which returns far more than you need.
- **`inspect_react_component({ selector })`** — full props + classified hooks for the component at
  that selector. Use immediately after the path call to see the component's own state.
- **`inspect_react_context({ selector })`** — walks *up* and lists every `Context.Provider` value
  reaching this component. Reach for it the moment a value is not in props and not in the store
  (theme, locale, auth, form context).
- **`get_component_tree({ start_selector, max_depth })`** — a scoped *subtree*. Use only when you
  need to see what the component renders **below** it. Always pass `start_selector`; an unscoped
  tree of a real app is mostly noise.

### Find a component when you have a name, not a selector

- **`find_react_component({ name, prop_filter, start_selector })`** — all instances, filterable by
  props. Use for "which of the 12 rows is the broken one?" — `prop_filter` narrows to it.
- **`inspect_react_component_by_name({ name, instance_index, key })`** — deep-inspect one specific
  instance once `find_react_component` has told you which.

### Data provenance — where did the wrong value come from?

Ask this in order; stop as soon as you have the answer.

- **`get_store_state({ path })`** — Redux/Zustand state, dot-path scoped (`formManager.schema`).
  Always pass the narrowest `path` you can; whole-store dumps are large and get truncated.
- **`get_network_responses({ url_pattern, status_filter })`** — what the API *actually* returned.
  Use whenever the UI shows data that the code says should be correct: it settles "bad data" vs
  "bad rendering" in one call.
- **`get_page_info()`** — React version, dev/prod build, which store is detected. Cheap. Run it
  first if anything looks structurally wrong (e.g. no components found at all).
- **`get_react_error_boundaries()`** — only when the screen is blank or a subtree vanished.

### Grounding in live execution (see the escalation ladder below)

- **`set_breakpoint({ file, line, condition })`** — pauses execution. `condition` is what makes this
  usable in a list or a loop: `set_breakpoint({ file: 'Row.tsx', line: 42, condition: 'item.id === 5' })`
  fires only on the row you care about.
- **`wait_for_breakpoint({ timeout_seconds })`** — blocks until it fires; returns the scope.
- **`inspect_scope({ frame_index })`** — variables at any frame. **Walk up the frames** — the caller's
  scope is usually where the bad value was *produced*, while the breakpoint frame only shows where
  it was *consumed*.
- **`evaluate_at_breakpoint({ expression })`** — run any JS in the paused frame. The fastest way to
  test a hypothesis: `typeof item.price`, `Object.keys(props)`, `schema.fields.map(f => f.key)`.
- **`step_over` / `step_into` / `step_out`** — trace a value across a transformation. `step_into` is how
  you follow a call *into* `@ermis-common-ui` or a package.
- **`resume`** — **always**, after every inspection.
- **`set_logpoint({ file, line, expressions, label })`** — records values **without pausing**. Output goes
  to the browser console as `⚡RDM|<label>|<timestamp>|<JSON>`.
- **`list_breakpoints`** / **`remove_all_breakpoints`** — audit and clean up.
- **`evaluate_in_page({ expression })`** — ad-hoc JS in the page, no pause required. Good for a quick
  DOM/global check (`document.querySelectorAll('.row').length`).

## The companion server: `chrome-devtools-mcp`

`react-debug-mcp` cannot see the console, cannot see the screen, and cannot touch the page.
`chrome-devtools-mcp` does all three. It is **restricted** — read the permission rule below.

### Always allowed (read-only — no permission needed)

- **Read console messages.** This is **the only way to collect logpoint output.** `set_logpoint`
  writes to the browser console (`⚡RDM|<label>|<timestamp>|<JSON>`) and `react-debug-mcp` never reads
  it back — so **a logpoint without chrome-devtools-mcp is useless.** Filter console output for the
  `⚡RDM` prefix to separate your captures from the app's own noise.
- **Take a screenshot.** Use it to see what the user is actually looking at — which page, which
  state, which element is visibly wrong. Cheap, and it frequently prevents an investigation of the
  wrong component. Take one early if the user's description is at all ambiguous.

### Requires explicit permission (automation)

Clicking, typing, filling forms, navigating, reloading.

> **Do not automate the browser unless the user has explicitly allowed it** — e.g. "go ahead and
> click it", "you can drive the browser", "automate the steps". Silence is not permission.
> Without it, **ask the user to perform the action** and wait: *"I've set the breakpoint — please
> click Submit."*

The reason is not ceremony: this is the user's real, stateful app session. An unrequested click can
submit a form, mutate data, or navigate away from the very state you were asked to investigate.

### Which server for what — they overlap

| Need | Use | Why |
|---|---|---|
| Component tree, props, hooks, context | **react-debug-mcp** | chrome-devtools-mcp has no React awareness. |
| Redux/store state | **react-debug-mcp** | Same. |
| API requests + response bodies | **react-debug-mcp** (`get_network_responses`) | Filters out static assets and marks live-vs-historical bodies. |
| Breakpoints, logpoints, stepping | **react-debug-mcp** | Resolves original `.tsx` file+line through source maps. |
| **Console output (incl. `⚡RDM`)** | **chrome-devtools-mcp** | Only it can read the console. |
| **Screenshot / visual page state** | **chrome-devtools-mcp** | Only it can see. |
| **Interaction** (click, type, navigate) | **chrome-devtools-mcp**, *with permission* | Only it can act. |

Rule of thumb: **react-debug-mcp to understand, chrome-devtools-mcp to see and (with permission)
to act.**

## The loop

### 1. Anchor

```
get_react_component_path({ selector, show_props: true })
inspect_react_component({ selector })
```

If the user's description of the symptom is at all ambiguous — or you are not certain which page or
state the app is in — **take a screenshot via chrome-devtools-mcp first.** It is cheap and it stops
you investigating the wrong component.

You now know: the component, its ancestors, its props, its hooks. **Restate the user's question as
a concrete claim you can prove or disprove**, e.g. "`MdcButton.disabled` is `true` when it should
be `false`", before going further.

### 2. Locate the source

Map the runtime component names to files on the filesystem (Grep). Establish the **layer** of each
file you touch (see the table above) — you need this before you can propose anything.

### 3. Trace the value backwards

For the specific wrong value, answer: *where does it come from?*

- from **props** → walk up the component path; inspect the owner
- from **hooks/local state** → `inspect_react_component` on that component
- from **context** → `inspect_react_context`
- from the **store** → `get_store_state({ path })`
- from an **API** → `get_network_responses({ url_pattern })`
- from a **package** → open the package's source and keep tracing

Keep going until you reach the origin. Do not stop at "it comes from `@ermis-common-ui`" — go in.

### 4. Escalate to live execution

Move to breakpoints/logpoints when **any** of these is true:

- Static reading yields **two or more plausible causes** and no way to discriminate between them.
- The code says X but the runtime shows Y (a transform is happening you cannot see).
- The value is produced inside a closure/hook/selector whose intermediate state is not visible
  in props or store.
- The value crosses **two or more files** and you need to see where it degrades.
- **The user asked for empirical proof**, said "actually check", or said they don't believe the
  static reading.

**Breakpoint vs logpoint:**

| Situation | Use |
|---|---|
| One-shot event (submit, click), need the full scope and to step through | **breakpoint** |
| Renders repeatedly / a list / a loop — you need to compare many executions | **logpoint** |
| Pausing would break the thing you're observing (timers, animation, focus) | **logpoint** |
| You know which iteration is wrong | **breakpoint** with `condition` |

**Breakpoint protocol — follow exactly:**

1. Read the file from the **filesystem** and pick the line there.
2. `set_breakpoint({ file: 'Original.tsx', line: N })` — original name, original line.
3. **Trigger it.** Ask the user — *"I've set a breakpoint at `X.tsx:42` — please click Submit."* —
   and wait. Only drive the click yourself, via chrome-devtools-mcp, if the user has explicitly
   granted automation permission.
4. `wait_for_breakpoint()`.
5. `inspect_scope()`, walk frames, `evaluate_at_breakpoint()` to test hypotheses, `step_*` to trace.
6. **`resume()`** — never leave the app paused.
7. `remove_all_breakpoints()` when the investigation ends.

**Logpoint protocol:**

1. `set_logpoint({ file, line, expressions, label })` — give it a distinctive `label`; you will filter
   the console on it.
2. Ask the user to exercise the flow (scroll the list, retype the field, re-run the search). Automate
   only with permission.
3. **Read the console via chrome-devtools-mcp** and filter for `⚡RDM|<label>`. `react-debug-mcp`
   cannot read its own logpoint output — this step is not optional.
4. Compare executions across the captured lines and find the one that diverges. That divergence is
   the lead.
5. `remove_all_breakpoints()` when done (it clears logpoints too).

### 5. Report

State the root cause with **observed values**, then scope the fix by layer:

- Consumer app or `@ermis-common-ui` → **propose the fix** (file, line, change, why it works).
- `ids-*` or other third-party → **state the defect only**, plus a workaround in a layer we own if
  one exists (labelled as a workaround).

## Worked examples

These show the **decisions**, not just the calls. The tool sequence is the easy part; knowing when
to cross a layer boundary, when to stop reading and start pausing, and what you are allowed to
propose is the job.

### A. Static trace across layers → fix lands in `@ermis-common-ui`

```
User: "[data-testid='find-declaration-crdactbtn-search'] — the Search button is
       disabled and I don't know why."

→ get_react_component_path({ selector: "[data-testid='find-declaration-crdactbtn-search']",
                             show_props: true })
    root → … → DeclarationsSearch → FormProvider → DeclarationsFilters → MdcButton
    MdcButton.disabled = true                     ← claim to prove: this should be false

  The prop comes from the owner, not the button. Walk UP, don't inspect the button.

→ inspect_react_component({ selector: "[data-testid='find-declaration-crdactbtn-search']" })
    parent DeclarationsFilters passes disabled={isSearchDisabled}

  Where does isSearchDisabled come from? Grep the consumer app.

  (filesystem) DeclarationsFilters.tsx:88
    const isSearchDisabled = !useFormIsValid();     ← from @ermis-common-ui

  TRAIL ENTERS A PACKAGE — follow it in. @ermis-common-ui is symlinked, so its
  ORIGINAL source is on disk. Read it from the filesystem, not read_source.

  (filesystem) node_modules/@ermis-common-ui/hooks/useFormIsValid.ts:14
    return Object.keys(errors).length === 0 && isDirty;
                                               ^^^^^^^  requires a user edit

→ inspect_react_component({ selector: "form" })      // confirm at runtime
    hooks: { errors: {}, isDirty: false }            ← errors empty, but isDirty false

  Root cause: useFormIsValid() ANDs validity with isDirty, so a pristine-but-valid
  form (prefilled defaults) reports invalid. The button is correctly reflecting a
  wrong hook.

  LAYER = @ermis-common-ui → team owns it → PROPOSE THE FIX there:
    useFormIsValid should not conflate "valid" with "dirty"; split into
    useFormIsValid() and useFormIsDirty(), and have DeclarationsFilters decide.
```

The lesson: the symptom was on an `ids` component, but the **defect was two layers up**. Never stop
at the component that renders the symptom.

### B. Defect in a third-party package → diagnose only, workaround in a layer we own

```
User: "MdcTypography renders the raw key 'ns:someLabel' instead of the translation."

→ inspect_react_component({ selector: '.mdc-typography--label' })
    props: { label: 'ns:someLabel' }         ← the RAW key reached the component

  So the component is faithfully rendering what it was given. The bug is upstream of
  it — the translation lookup, not the rendering. Do NOT go into ids-*.

→ get_network_responses({ url_pattern: 'language-pack' })
    200 — and the response DOES contain "someLabel" under namespace "ns"

  Data is present, lookup failed. Prove it in the page:

→ evaluate_in_page({ expression: "i18n.exists('someLabel', { ns: 'ns' })" })
    false

  (filesystem) the caller passes t('ns:someLabel') — prefixed key AND an ns option,
  so i18next looks up namespace "ns" for key "ns:someLabel" → miss.

  LAYER = consumer app → PROPOSE THE FIX: t('someLabel', { ns: 'ns' }).
```

Now the variant where the defect really *is* in `ids-*`:

```
  Suppose instead the label prop was correct ('Search') but MdcTypography rendered
  the key anyway. Then the defect IS inside ids-react-components.

  → read_source({ file: 'ids-wc' })        // third-party: bundled code, not on disk
      confirms it reads props.i18nKey, ignoring props.label when both are set

  LAYER = ids-* → NOT ours → STATE THE DEFECT ONLY:
    "ids-wc MdcTypography prefers i18nKey over label; passing both silently drops
     label. Report to the ids team."
  Then offer a WORKAROUND in a layer we own (clearly labelled):
    "Workaround (consumer app): stop passing i18nKey, pass only label."

  NEVER write a patch into node_modules/ids-wc.
```

### C. Static analysis stalls → escalate to a breakpoint

```
User: "The total on the declaration line is wrong — shows 09.999.99."

  Static reading gives TWO plausible causes and no way to choose:
    (a) the API returns price as a string, or
    (b) calculateTotal concatenates instead of adding.
  → ESCALATION TRIGGER: 2+ candidates, no discriminator. Stop reading. Pause.

  (filesystem) read calculateTotal.ts → the sum happens at line 12

→ set_breakpoint({ file: 'calculateTotal.ts', line: 12 })
     ↑ ORIGINAL file + ORIGINAL line, from the filesystem — never a search_source line number

→ "Breakpoint set at calculateTotal.ts:12 — please add an item to the declaration."
     ↑ ask; do NOT click it yourself without automation permission

→ wait_for_breakpoint()
    scope: { items: [{ price: "9.99" }, { price: "5.00" }], sum: "09.99" }

→ evaluate_at_breakpoint({ expression: 'typeof items[0].price' })
    "string"                                  ← BOTH causes were real; (a) is the root

  The breakpoint frame shows the value being CONSUMED. Where was it PRODUCED?
→ inspect_scope({ frame_index: 1 })     // walk up the stack
    the caller mapped it straight from the API payload — no coercion anywhere

→ resume()                              ← ALWAYS
→ remove_all_breakpoints()

  Root cause: API delivers price as a string; calculateTotal's `+` concatenates.
  LAYER = consumer app (the mapper) → propose coercion at the boundary, not in
  calculateTotal — fixing it downstream would leave every other consumer broken.
```

### D. Repeated renders → logpoint (never a breakpoint)

```
User: "Some rows in the list show the wrong price, but I can't tell which."

  "Some" + "a list" = many executions, and pausing on every row is unusable.
  → LOGPOINT, not a breakpoint.

  (filesystem) Row.tsx:15 → const display = formatPrice(props.price);

→ set_logpoint({
    file: 'Row.tsx', line: 15,
    expressions: { id: 'props.id', price: 'props.price', display: 'display' },
    label: 'row-price'
  })

→ "Logpoint set — please scroll through the list."

→ (chrome-devtools-mcp) read console messages, filter for ⚡RDM|row-price
     ⚡RDM|row-price|…|{"id":1,"price":9.99,"display":"$9.99"}
     ⚡RDM|row-price|…|{"id":2,"price":"5.00","display":"$NaN"}     ← diverges
     ⚡RDM|row-price|…|{"id":3,"price":12.5,"display":"$12.50"}

  react-debug-mcp CANNOT read this back — the console read is only possible through
  chrome-devtools-mcp. Without it the logpoint produces nothing.

  Row 2's price is a string. Same root cause as (C), found without freezing the UI.

→ remove_all_breakpoints()          // clears logpoints too
```

If you knew in advance that row 2 was the bad one, a **conditional breakpoint** would be the sharper
tool: `set_breakpoint({ file: 'Row.tsx', line: 15, condition: 'props.id === 2' })`.

## Stop and ask — do not guess

Stop and ask the user when:

- You cannot tell which route/page/state the app is in and no tool reveals it.
- The selector matches nothing, or matches a component you cannot identify.
- Runtime values **contradict** the source you're reading (ask them to describe what they see —
  the build may be stale, or you may be on a different page than you think).
- You have exhausted static + runtime investigation. Summarise what you found and what you need.

Guessing is worse than asking. You have runtime tools — if a fact is *obtainable*, obtain it; if it
is not, ask for it.

## Traps in this stack (read before your first investigation)

**A component still showing as `forwardRef(Anonymous)` means its library was never registered.**

A component built with `forwardRef`/`memo` and no `displayName` has **no name at runtime** — React
itself cannot report one, so the tree shows `forwardRef(Anonymous)` (React DevTools shows the same).
The app already fixes this for its design system by calling `nameLibraryComponents(Ids)` at startup,
which copies each export name onto `displayName`. So **`ids` components appear under their real
names** (`MdcButton`, `MdcGrid`, …) and `find_react_component({ name: 'MdcButton' })` works normally.

Therefore, when you *do* hit an `Anonymous` node, read it as a signal rather than noise:

- It is a component from a library that was **not** passed to `nameLibraryComponents` — another
  third-party package, or an internal component the design system renders but does not export.
- **Do not guess what it is** from its position or props. Identify it: `inspect_react_component` on a
  selector inside it, then `read_source`/`search_source` on the bundle to see which package it came
  from (it is third-party, so its source is bundled, not on disk).
- **Navigation never depends on names.** `get_react_component_path` and `inspect_react_component`
  work from a selector, so an anonymous node never blocks you — route around it.
- If the anonymous component turns out to be central to the bug, tell the user which library it is
  and that adding it to the `nameLibraryComponents(...)` call will name it for future sessions.

**`get_store_state` returns `{ store: 'none' }`.** This does **not** mean the app has no Redux. It
means the app never exposed the store on `window`. Ask the user to add `exposeStore(store, 'redux')`
(from `react-debug-helper.ts`) in dev. Do not conclude "no store" from this.

**Network results marked `source: "historical"` have no response body.** They were captured before
the MCP connected — you get URL, status and timing only. If you need the body, **ask the user to
redo the action** so it is captured live, then call `get_network_responses` again.

**Function props render as `[function]`.** If you need to read a handler's body, pass
`show_function_details: true` — supported by `get_component_tree`, `get_react_component_path`,
`find_react_component`, `inspect_react_component`, and `inspect_react_component_by_name`.

**Never leave the app paused.** A forgotten pause looks to the user like the app has frozen.
`resume()` after every inspection, `remove_all_breakpoints()` at the end.

## Report format

End every investigation with:

```
### Findings
- **Question**: <the concrete claim you set out to prove>
- **Root cause**: <what is actually happening, with the observed values that prove it>
- **Evidence**: <tool calls + the values they returned; breakpoint scopes; API responses>
- **Layer**: consumer app / @ermis-common-ui / ids-* / other third-party / undetermined
- **Fix**: <proposed change — or, for third-party, the defect statement + any workaround we own>
- **Cleanup**: breakpoints removed — yes / no / n/a
```
