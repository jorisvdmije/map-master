import assert from "node:assert/strict";
import { resolve } from "node:path";

/** Controls must fit the map itself, including its mobile embedded layout. */
export async function checkControlLayout({ context, origin, evidence }) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const examples = [
    ["examples", "polygon"], ["shape-templates", "template"], ["text-markers", "text"],
    ["buffer", "buffer"], ["offset", "offset"], ["scaling", "scale"],
    ["rotation", "rotate"], ["simplification", "simplify"], ["remove-hole", "remove-hole"],
    ["lasso", "lasso"], ["data-layers", null],
    ["difference", "difference"],
  ];
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/map-master/guides/appearance/`, { waitUntil: 'networkidle' });
    await page.locator('[data-demo]').scrollIntoViewIfNeeded();
    await page.locator('[data-ready="true"]').waitFor();
    const scale = page.getByRole('checkbox', { name: 'Scale polygon borders with zoom' });
    assert.equal(await scale.isChecked(), true);
    await page.locator('.mm-toolbar-button[data-tool="polygon"]').click();
    const canvas = page.locator('.demo-map canvas'); const box = await canvas.boundingBox();
    for (const [x, y] of [[0.3, 0.65], [0.7, 0.65], [0.5, 0.9]]) {
      await canvas.click({ position: { x: box.width * x, y: box.height * y } });
    }
    const draftWidth = () => page.locator('[data-geo-draft-border] [data-geo-border]').getAttribute('stroke-width');
    const fullWidth = Number(await draftWidth());
    assert.ok(fullWidth > 0);
    const data = await page.locator('[data-demo]').getAttribute('data-feature-count');
    await page.locator('.maplibregl-ctrl-zoom-out').click();
    await page.waitForFunction(max => Number(document.querySelector('[data-geo-draft-border] [data-geo-border]')?.getAttribute('stroke-width')) < max - 0.01, fullWidth);
    await scale.uncheck();
    assert.equal(Number(await draftWidth()), fullWidth);
    await scale.check();
    await page.waitForFunction(max => Number(document.querySelector('[data-geo-draft-border] [data-geo-border]')?.getAttribute('stroke-width')) < max - 0.01, fullWidth);
    assert.equal(await page.locator('[data-demo]').getAttribute('data-mode'), 'draw-polygon');
    assert.equal(await page.locator('[data-demo]').getAttribute('data-feature-count'), data);
    console.log('✓ Zoom-scaled polygon borders and live appearance toggle preserve the active draft');

    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [slug, tool] of examples) {
        await page.goto(`${origin}/map-master/guides/${slug}/`, { waitUntil: "networkidle" });
        await page.locator("[data-demo]").scrollIntoViewIfNeeded();
        await page.locator('[data-ready="true"]').waitFor();
        for (const toggle of await page.locator('.mm-toolbar-button[data-tool="toggle"]').all()) {
          if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
        }
        if (tool) await page.locator(`.mm-toolbar-button[data-tool="${tool}"]`).click();
        else await page.locator(".mm-data-layers>button").click();
        const overflow = await page.locator(".demo-map").evaluate(map => {
          const bounds = map.getBoundingClientRect();
          return [...map.querySelectorAll(".mm-toolbar,.mm-toolbar-actions,.mm-toolbar-tooltip,.mm-data-layers,.mm-data-layers-panel")]
            .filter(node => node.checkVisibility()).flatMap(node => {
              const box = node.getBoundingClientRect();
              return box.left < bounds.left - 1 || box.top < bounds.top - 1 || box.right > bounds.right + 1 || box.bottom > bounds.bottom + 1
                ? [{ className: node.className, left: box.left - bounds.left, top: box.top - bounds.top, width: box.width, height: box.height }] : [];
            });
        });
        assert.deepEqual(overflow, [], `Map controls overflow in ${slug} at viewport ${width}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (width === 320 && ["examples", "shape-templates", "data-layers"].includes(slug)) {
          await page.locator(".demo").screenshot({ path: resolve(evidence, `layout-mobile-${slug}.png`) });
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log("✓ All-tools toolbar, data layers and action panels, including Difference, stay inside embedded mobile/tablet maps");
  } finally { await page.close(); }
}
