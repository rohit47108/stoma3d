/* Run against localhost or the deployed site. Playwright is supplied by the
 * verification runtime, not bundled into the website. See docs/RECORDING.md. */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const runtime = process.env.STOMA_PLAYWRIGHT_PATH || "playwright";
const { chromium, firefox, webkit } = require(runtime);
const { expect: baseExpect } = require(`${runtime}/test`);
const expect = baseExpect.configure({ timeout: 20000 });

const baseURL = process.env.STOMA_DEMO_URL || "http://localhost:3027";
const output = path.resolve(
  process.env.STOMA_DEMO_OUTPUT || "outputs/website-demo-verification",
);
const engineNames = (
  process.env.STOMA_DEMO_ENGINES || "chromium,firefox,webkit"
).split(",");
const labels = [
  "Top of tongue",
  "Underside of tongue",
  "Left inner cheek",
  "Right inner cheek",
  "Inside upper lip",
  "Inside lower lip",
  "Upper dental arch and gums",
  "Lower dental arch and gums",
];

async function recordCount(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("stoma3d-guest-v1");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("records", "readonly");
          const request = tx.objectStore("records").count();
          request.onsuccess = () => resolve(request.result);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}

async function checkLayout(page) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headingFocused: document.activeElement?.tagName === "H1",
    actions: [
      ...document.querySelectorAll(".demo-controls-actions button"),
    ].map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height, bottom: box.bottom };
    }),
  }));
  assert.ok(
    layout.scrollWidth <= layout.width + 1,
    "No horizontal page overflow",
  );
  assert.ok(layout.headingFocused, "Step heading receives focus");
  for (const box of layout.actions) {
    assert.ok(
      box.width >= 44 && box.height >= 44,
      "Primary controls have 44px targets",
    );
  }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const results = [];
  for (const engineName of engineNames) {
    const browser = await { chromium, firefox, webkit }[engineName].launch({
      headless: true,
    });
    try {
      for (const width of [390, 1440]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const errors = [],
          requests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (/\/api\/scan\//.test(request.url())) requests.push(request.url());
        });
        await page.goto(baseURL, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", { name: "Start scan", exact: true }),
        ).toBeVisible();
        assert.equal(new URL(page.url()).pathname, "/");
        const before = await recordCount(page);
        await page
          .getByRole("button", { name: "Try guided demo", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "A clearer view of your mouth",
            exact: true,
          }),
        ).toBeVisible();
        await checkLayout(page);
        await page.screenshot({
          path: path.join(output, `${engineName}-${width}-welcome.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Start sample scan", exact: true })
          .click();
        for (let i = 0; i < labels.length; i++) {
          await expect(
            page.getByRole("heading", { name: labels[i], exact: true }),
          ).toBeVisible();
          await checkLayout(page);
          assert.equal(new URL(page.url()).pathname, "/");
          if (i === 2)
            await page.screenshot({
              path: path.join(output, `${engineName}-${width}-photo.png`),
              fullPage: true,
            });
          await page
            .getByRole("button", {
              name: i === 7 ? "View results" : "Next",
              exact: true,
            })
            .click();
        }
        await expect(
          page.getByRole("heading", {
            name: "Your scan, brought together",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", {
            name: "Hide observation outline",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", {
            name: "Show observation outline",
            exact: true,
          }),
        ).toHaveAttribute("aria-pressed", "false");
        await page
          .getByRole("button", {
            name: "Show observation outline",
            exact: true,
          })
          .click();
        await page.screenshot({
          path: path.join(output, `${engineName}-${width}-results.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "View on 3D map", exact: true })
          .click();
        await expect(
          page.getByText("Opening the 3D map…", { exact: true }),
        ).toBeHidden();
        const canvas = page.getByRole("img", { name: /^Interactive oral map/ });
        const rendered3d = await canvas.isVisible();
        if (rendered3d) {
          await page
            .getByRole("button", { name: "Zoom in", exact: true })
            .click();
          await canvas.press("ArrowRight");
        } else {
          await expect(
            page.getByRole("heading", { name: "Region view", exact: true }),
          ).toBeVisible();
        }
        await page
          .getByRole("button", { name: /Left cheek.*Photo accepted/ })
          .click();
        await expect(
          page.getByRole("heading", { name: "Left inner cheek", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: path.join(output, `${engineName}-${width}-map.png`),
          fullPage: true,
        });
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "October 17, 2026", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "October 3, 2026", exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await expect(
          page.getByText("20% smaller normalized area", { exact: true }),
        ).toBeHidden();
        await page
          .getByRole("checkbox", {
            name: "These show the same sample observation",
            exact: true,
          })
          .check();
        await expect(
          page.getByText("20% smaller normalized area", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("slider", {
            name: "Compare example outlines",
            exact: true,
          })
          .fill("70");
        await page.screenshot({
          path: path.join(output, `${engineName}-${width}-compare.png`),
          fullPage: true,
        });
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await expect(
          page.getByRole("region", {
            name: "Sample observation report",
            exact: true,
          }),
        ).toContainText("20% smaller sample area");
        await page.emulateMedia({ media: "print" });
        await expect(
          page.getByRole("region", {
            name: "Sample observation report",
            exact: true,
          }),
        ).toBeVisible();
        await page.emulateMedia({ media: "screen" });
        await page
          .getByRole("button", { name: "Prepare sample PDF", exact: true })
          .click();
        const downloadEvent = page.waitForEvent("download");
        await page
          .getByRole("link", { name: "Download sample PDF", exact: true })
          .click();
        const download = await downloadEvent;
        await download.saveAs(
          path.join(output, `${engineName}-${width}-sample-report.pdf`),
        );
        const pdf = await fs.readFile(await download.path());
        assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
        // The on-page report is the recording surface. Embedded browser tools
        // may prohibit PDF-tab navigation; verify the downloadable file instead.
        await page.screenshot({
          path: path.join(output, `${engineName}-${width}-report.png`),
          fullPage: true,
        });
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await expect(
          page.getByRole("checkbox", {
            name: "These show the same sample observation",
            exact: true,
          }),
        ).toBeChecked();
        await page
          .getByRole("navigation", { name: "Demo chapters", exact: true })
          .getByRole("button", { name: "Report", exact: true })
          .click();
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await expect(
          page.getByRole("heading", {
            name: "Ready for your own scan",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Skip", exact: true }),
        ).toBeDisabled();
        await page
          .getByRole("button", { name: "Restart", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Back", exact: true }),
        ).toBeDisabled();
        await page.getByRole("button", { name: "Skip", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: labels[0], exact: true }),
        ).toBeVisible();
        await page
          .getByRole("navigation", { name: "Demo chapters", exact: true })
          .getByRole("button", { name: "Compare", exact: true })
          .click();
        await expect(
          page.getByRole("checkbox", {
            name: "These show the same sample observation",
            exact: true,
          }),
        ).not.toBeChecked();
        await page
          .getByRole("button", { name: "Exit demo", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Start scan", exact: true }),
        ).toBeVisible();
        assert.equal(
          await recordCount(page),
          before,
          "Sample tour never adds real scan records",
        );
        assert.equal(
          requests.length,
          0,
          "Sample tour never calls analysis or model-card relay",
        );
        assert.deepEqual(errors, [], "No browser runtime errors");
        if (
          process.env.STOMA_DEMO_LIVE_IMAGE &&
          engineName === "chromium" &&
          width === 390
        ) {
          await page.route("**/api/scan/analyze", (route) =>
            route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  message: "Analysis is unavailable right now. Try again.",
                },
              }),
            }),
          );
          await page
            .getByRole("button", { name: "Start scan", exact: true })
            .click();
          await page
            .getByRole("checkbox", {
              name: "I have permission to scan and agree to send mouth-only photos for analysis.",
              exact: true,
            })
            .check();
          await page
            .getByRole("button", { name: "Continue", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Start scan", exact: true })
            .click();
          await page
            .getByLabel("Choose a mouth photo", { exact: true })
            .setInputFiles(path.resolve(process.env.STOMA_DEMO_LIVE_IMAGE));
          await expect(
            page.getByRole("heading", {
              name: "Review your photo",
              exact: true,
            }),
          ).toBeVisible();
          await page
            .getByRole("checkbox", {
              name: "This photo shows only the mouth. Send it for a privacy check and analysis.",
              exact: true,
            })
            .check();
          await page
            .getByRole("button", { name: "Use photo", exact: true })
            .click();
          await expect(
            page
              .getByRole("alert")
              .filter({ hasText: "Analysis is unavailable right now." }),
          ).toBeVisible();
          await expect(
            page.getByRole("img", {
              name: "Analyzed mouth photo",
              exact: true,
            }),
          ).toHaveCount(0);
          await expect(
            page.getByText("Sample demo", { exact: true }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", {
              name: "Try this photo again",
              exact: true,
            }),
          ).toBeEnabled();
          await page.getByRole("button", { name: "Home", exact: true }).click();
          const stored = await recordCount(page);
          assert.ok(
            stored > before,
            "Real unfinished scan is stored independently",
          );
          await page
            .getByRole("button", { name: "Try guided demo", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Restart", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Exit demo", exact: true })
            .click();
          assert.equal(
            await recordCount(page),
            stored,
            "Tour restart preserves existing real scans",
          );
          await expect(
            page.getByRole("button", { name: "Continue scan", exact: true }),
          ).toBeVisible();
        }
        await page.goto(`${baseURL}/scan`, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", {
            name: /^(Start|Continue) scan$/,
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(
          new URL(page.url()).pathname,
          "/",
          "Legacy /scan redirects to the root",
        );
        results.push({
          engine: engineName,
          width,
          rendered3d,
          requests: requests.length,
          errors,
          passed: true,
        });
        await context.close();
        console.log(JSON.stringify(results.at(-1)));
      }
    } finally {
      await browser.close();
    }
  }
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      { baseURL, verifiedAt: new Date().toISOString(), results },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
