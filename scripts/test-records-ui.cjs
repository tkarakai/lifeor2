const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const route = path.resolve(__dirname, "../app/records-ui-check");
const baseUrl = process.env.UI_TEST_BASE_URL || "http://localhost:3000";
(async () => {
  await fetch(baseUrl); // The normal local development server must be running.
  fs.mkdirSync(route); // Never overwrite a pre-existing application route.
  let browser;
  try {
    fs.writeFileSync(
      path.join(route, "page.tsx"),
      'export { default } from "@/tests/fixtures/records-workspace";\n',
    );
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${baseUrl}/records-ui-check`);
    await page
      .getByRole("heading", { name: "Entities", exact: true })
      .waitFor();
    await page.screenshot({ path: "/tmp/lifeor-crud-desktop.png" });
    assert.equal(await page.locator(".record-row").count(), 20);
    await page.getByRole("button", { name: "Next page" }).click();
    assert.equal(await page.locator(".record-row").count(), 5);
    await page
      .getByRole("searchbox", { name: "Search entities" })
      .fill("Morgan");
    assert.equal(await page.locator(".record-row").count(), 6);
    await page.getByLabel("Filter entities by type").selectOption("Person");
    assert.equal(await page.locator(".record-row").count(), 4);
    await page.getByLabel("Sort entities").selectOption("za");
    assert.match(
      await page.locator(".record-row").first().innerText(),
      /Sam Morgan/,
    );
    await page.getByRole("searchbox").fill("unmatched");
    await page.getByRole("heading", { name: "No matching entities" }).waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("button", { name: "New entity", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.locator("dialog input").count(), 2);
    const fields = await page.locator("dialog input").evaluateAll((inputs) =>
      inputs.map((input) => {
        const rect = input.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      }),
    );
    assert.equal(
      fields[0].top,
      fields[1].top,
      "paired inputs align with helper text",
    );
    assert.equal(fields[0].height, fields[1].height);
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    assert.notEqual(
      await cancel.evaluate((el) => getComputedStyle(el).backgroundColor),
      await page
        .locator("dialog input")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "secondary buttons must have a distinct surface from inputs",
    );
    assert.ok(
      await page
        .getByRole("textbox", { name: "Kind", exact: true })
        .getAttribute("aria-describedby"),
    );
    await page.getByRole("textbox", { name: "Display name" }).fill("error");
    await page
      .getByRole("button", { name: "Create entity", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "A test failure" })
      .waitFor();
    assert.equal(
      await page.getByRole("textbox", { name: "Display name" }).inputValue(),
      "error",
    );
    await page
      .getByRole("textbox", { name: "Display name" })
      .fill("New person");
    await page
      .getByRole("button", { name: "Create entity", exact: true })
      .click();
    await page.waitForFunction(() => !document.querySelector("dialog"));
    await page.getByRole("searchbox").fill("New person");
    assert.equal(await page.locator(".record-row").count(), 1);
    await page
      .getByRole("button", { name: "Open New person", exact: true })
      .click();
    await page.screenshot({ path: "/tmp/lifeor-crud-editor.png" });
    await page
      .getByRole("textbox", { name: "Display name" })
      .fill("Updated person");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("dialog"));
    await page.getByRole("searchbox").fill("Updated person");
    assert.equal(await page.locator(".record-row").count(), 1);
    await page.getByRole("button", { name: "Open Updated person" }).click();
    await page.getByRole("textbox", { name: "Display name" }).fill("Unsaved");
    page.once("dialog", (d) => d.dismiss());
    await page.keyboard.press("Escape");
    assert.equal(
      await page.getByRole("textbox", { name: "Display name" }).inputValue(),
      "Unsaved",
    );
    page.once("dialog", (d) => d.accept());
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog"));
    assert.equal(
      await page
        .getByRole("button", { name: "Open Updated person" })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.getByRole("button", { name: "Open Updated person" }).click();
    await page
      .getByRole("button", { name: "Details & history", exact: true })
      .click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Note", exact: true })
      .fill("Test note");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    assert.equal(await page.locator("dialog[open]").count(), 2);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.getByRole("button", { name: "Open Updated person" }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("dialog"));
    await page.getByRole("button", { name: "Clear filters" }).click();
    for (const width of [1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `overflow at ${width}`,
      );
      if (width === 390) {
        await page.screenshot({ path: "/tmp/lifeor-crud-mobile.png" });
        await page
          .getByRole("button", { name: "New entity", exact: true })
          .click();
        await page.screenshot({ path: "/tmp/lifeor-crud-mobile-editor.png" });
        assert.equal(
          await page
            .locator("dialog")
            .evaluate((e) => e.scrollWidth <= e.clientWidth),
          true,
        );
        await page.keyboard.press("Escape");
      }
    }
    await page.getByRole("tab", { name: "All records" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.getByText("No archived records in this dataset.").waitFor();
    await page.getByRole("tab", { name: "Form layout" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "New arrangement type", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Type name", exact: true })
      .fill("Rental agreement");
    for (const name of ["Landlord", "Tenant", "Property"]) {
      await page
        .getByRole("button", { name: "Add role template", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Role name", exact: true })
        .last()
        .fill(name);
    }
    await page
      .getByRole("button", { name: "Remove template 2", exact: true })
      .click();
    assert.deepEqual(
      await page
        .getByRole("textbox", { name: "Role name", exact: true })
        .evaluateAll((fields) => fields.map((f) => f.value)),
      ["Landlord", "Property"],
    );
    for (const width of [1440, 768, 640, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page
          .locator("dialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
        true,
        `repeat form overflow at ${width}`,
      );
      if (width >= 640) {
        const controls = await page
          .locator(".record-repeat-row")
          .first()
          .locator("input, select")
          .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
        assert.equal(
          controls[0],
          controls[1],
          `repeat fields align at ${width}`,
        );
      }
      if (width === 1440 || width === 390) {
        await page.screenshot({
          path: `/tmp/lifeor-form-templates-${width}.png`,
        });
      }
    }
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("dialog"));
    assert.deepEqual(errors, []);
    console.log(
      "Passed: pagination, search, type filter, sort, empty/reset, create, error preservation, edit, archive, unsaved guard, focus return, nested drawer navigation, responsive 1024/768/390, keyboard tabs, distinct action surfaces, aligned fields, template add/remove/save at 1440/768/640/390; no runtime errors.",
    );
  } finally {
    await browser?.close();
    fs.rmSync(route, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
