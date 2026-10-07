import { test, expect } from "@playwright/test";
import { chicagoToISO, localDateTime } from "../../shared/domain";
import { dayBounds } from "../../shared/timeline";

for (const localNow of [
  "2026-12-21T20:15",
  "2026-06-21T00:05",
  "2026-03-08T23:55",
]) {
  test(`daylight labels and live marker fit at ${localNow}`, async ({
    page,
  }, testInfo) => {
    const now = Date.parse(chicagoToISO(localNow));
    const day = localNow.slice(0, 10);
    const [start, end] = dayBounds(day);
    await page.clock.install({ time: now - 1000 });
    await page.clock.pauseAt(now);
    await page.route("**/api/weather", (route) =>
      route.fulfill({
        json: {
          fetched_at: new Date(now).toISOString(),
          provider: "Test fixture",
          source_kind: "fixture",
          model_version: "hannah-1.0.0",
          hours: Array.from(
            { length: Math.round((end - start) / 3600000) + 1 },
            (_, i) => ({
              time: new Date(start + i * 3600000).toISOString(),
              wind: 7,
              gust: 12,
              direction: 180,
              temperature: 65,
              precipitation: 0,
              probability: 0,
              visibility: 16000,
              code: 0,
            }),
          ),
        },
      }),
    );
    await page.goto("/?tab=Today");
    const chart = page.locator(".chart-surface");
    const daylight = chart.locator(".chart-daylight-strip");
    await expect(daylight).toHaveCount(1);
    const sunrise = Number(await daylight.getAttribute("data-sunrise"));
    const sunset = Number(await daylight.getAttribute("data-sunset"));
    for (const time of [sunrise, sunset])
      expect(localDateTime(new Date(time).toISOString()).slice(0, 10)).toBe(
        day,
      );
    await expect(chart.locator(".chart-daylight")).toHaveAttribute(
      "aria-label",
      /sunrise .* sunset /,
    );
    await expect(chart.locator(".chart-wind-rule text")).toHaveText([
      "0",
      "10",
      "20",
      "30",
    ]);
    // Check spacing, clipping, and actual label bounds, including the shortest day.
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBe(width);
      await expect
        .poll(() =>
          chart.evaluate((e) =>
            Math.abs(
              e.getBoundingClientRect().width -
                (e as SVGSVGElement).viewBox.baseVal.width,
            ),
          ),
        )
        .toBeLessThan(1);
      const layout = await chart.evaluate((svg) => {
        const rect = (selector: string) => {
          const r = svg.querySelector(selector)!.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        const windRules = Array.from(
          svg.querySelectorAll(".chart-wind-rule"),
          (e) => Number(e.getAttribute("data-mph")),
        );
        const minor = svg.querySelector(".chart-wind-minor-rule")!;
        return {
          surface: svg.getBoundingClientRect().toJSON(),
          sunrise: rect(".chart-sunrise-label"),
          daylight: rect(".chart-daylight-label"),
          sunset: rect(".chart-sunset-label"),
          now: rect(".chart-now-label"),
          marker: rect(".chart-now"),
          strip: rect(".chart-daylight-strip"),
          windRules,
          minorOpacity: Number(getComputedStyle(minor).strokeOpacity),
        };
      });
      expect(layout.windRules).toEqual([0, 5, 10, 15, 20, 25, 30]);
      expect(layout.minorOpacity).toBeLessThan(1);
      expect(layout.now.bottom).toBeLessThan(layout.marker.bottom);
      expect(layout.daylight.top).toBeGreaterThan(layout.strip.bottom);
      expect(Math.abs(layout.sunrise.top - layout.daylight.top)).toBeLessThan(
        1,
      );
      expect(Math.abs(layout.sunset.top - layout.daylight.top)).toBeLessThan(1);
      expect(layout.sunrise.right + 4).toBeLessThan(layout.daylight.left);
      expect(layout.daylight.right + 4).toBeLessThan(layout.sunset.left);
      for (const label of [
        layout.sunrise,
        layout.daylight,
        layout.sunset,
        layout.now,
      ]) {
        expect(label.left).toBeGreaterThanOrEqual(layout.surface.left);
        expect(label.right).toBeLessThanOrEqual(layout.surface.right);
        expect(label.bottom).toBeLessThanOrEqual(layout.surface.bottom);
      }
      await page.screenshot({
        path: testInfo.outputPath(`daylight-${width}.png`),
        fullPage: true,
      });
    }
    // Inspecting a different sample must not move the solar strip or live marker.
    const solarX = await daylight.getAttribute("x");
    const nowX = await chart.locator(".chart-now").getAttribute("x1");
    await chart.press("Home");
    await expect(daylight).toHaveAttribute("x", solarX!);
    await expect(chart.locator(".chart-now")).toHaveAttribute("x1", nowX!);
  });
}
