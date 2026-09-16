# Records workspace

The CRUD workspace uses the Observatory palette: warm paper, forest green, teal actions, and serif headings. Navigation is grouped into Explore, Life & relationships, Money & planning, and Workspace.

Record collections are flat, searchable lists with type filters, name sorting, counts, and 20-row pagination. Selecting a row opens a native modal drawer. Common edit fields appear immediately; relationships, notes, history, corrections, and other secondary actions open focused drawers with Back navigation. Record content and its additional queries mount only when opened. Forms preserve errors and drafts, disable submission while saving, close on success, and protect unsaved changes. Closing restores keyboard focus. Nested drawers make the previous drawer inert, and Escape dismisses only the current drawer.

Planning uses tabs for plans, schedules, expectations, assumptions, and scenarios. Account mappings have a separate tab from ledger accounts. Records and Finance home use linked directories. Existing mutations, revisions, archive semantics, financial calculations, and dataset boundaries are preserved.

## Validation

- `bun run typecheck` checks frontend and Convex types.
- `bun run test` runs the domain suite.
- With the local frontend running, `bun run test:ui` runs Chromium workflow checks. Install Chromium once with `bun x playwright install chromium`. `UI_TEST_BASE_URL` overrides `http://localhost:3000`.

The browser check temporarily creates `/records-ui-check` and removes it on completion, including failure. It renders the shared workspace with fictional in-memory records; it does not write to a live dataset. It checks search, filters, sorting, pagination, creation, editing, archive, error preservation, dirty-state confirmation, nested drawer navigation, focus restoration, keyboard tabs, and desktop/tablet/mobile overflow. Screenshots are written to `/tmp/lifeor-crud-*.png`. Live backend behavior is covered by the existing domain tests, not by the isolated browser fixture.

## Form and context refinement

Entry controls use white surfaces, visible borders, associated labels, required markers, and programmatically linked helper text. Secondary actions use filled sage surfaces; primary actions use forest green. Form footers separate Cancel and Save from data entry, with visual order matching keyboard order. Two-column field grids share label, control, and helper-text tracks so wrapped labels remain aligned. Mobile forms collapse into a single column and use 16px input text.

Role templates and journal postings use numbered groups with removal actions in their headers. Transaction and obligation forms separate related information into named sections. Collections align record identity, category, and summary columns and expose context already available in their list queries: arrangement lifecycle, template roles, measurement subjects and sources, original obligation amounts, event end/void details, schedule terms, and assumption values. This adds no per-row queries. Drawers repeat meaningful summary context above editing controls.

The browser fixture also exercises the production arrangement-type form: add, remove, preserve remaining values, and save. Layout checks cover matching field positions, helper-text association, distinct secondary-button and input surfaces, and repeat-form overflow at 1440, 768, 640, and 390px. Additional screenshots are written to `/tmp/lifeor-form-templates-*.png`.
