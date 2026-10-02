const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  let file = path.join(root, new URL(req.url, "http://localhost").pathname);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      }[path.extname(file)] || "application/octet-stream",
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/promo.html`);
    for (const width of [320, 390, 768, 1200]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const mode of ["duel", "style", "referral"]) {
        await page.locator(`button[data-mode=${mode}]`).click();
        await page.waitForTimeout(30);
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `overflow ${width} ${mode}`,
        );
        assert((await page.locator("#caption").inputValue()).length > 80);
        if (mode === "referral")
          assert(
            (await page.locator("#caption").inputValue()).includes(
              "[ВСТАВЬ СВОЮ ССЫЛКУ",
            ),
          );
      }
    }
    await page.setViewportSize({ width: 1080, height: 1500 });
    await page.addStyleTag({
      content:
        "main{max-width:none;padding:0}header,.intro,nav,.instructions,footer{display:none}.layout{display:block}.poster-wrap{width:1080px;height:1350px;border-radius:0;outline:0;overflow:visible}.poster{position:relative;transform:none!important}",
    });
    for (const mode of ["duel", "style", "referral"]) {
      await page.evaluate(
        (m) => document.querySelector(`button[data-mode="${m}"]`).click(),
        mode,
      );
      await page
        .locator("#poster")
        .screenshot({ path: path.join(root, `promo/post-${mode}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: promotion kit at 4 widths, all 3 captions, referral placeholder and exported 1080×1350 posters.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
