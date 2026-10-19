/**
 * Renders the PWA icons (PNG) from the SVG sources in public/icons with headless Chromium.
 * Run after changing icon.svg / icon-maskable.svg: `npm run icons`.
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = 'public/icons';
const jobs = [
  { src: 'icon.svg', size: 192, out: 'icon-192.png', transparent: true },
  { src: 'icon.svg', size: 512, out: 'icon-512.png', transparent: true },
  { src: 'icon-maskable.svg', size: 512, out: 'icon-maskable-512.png', transparent: false },
  { src: 'icon-maskable.svg', size: 192, out: 'icon-maskable-192.png', transparent: false },
  // iOS / iPadOS home screen: full-bleed, the system applies its own mask.
  { src: 'icon-maskable.svg', size: 180, out: 'apple-touch-icon.png', transparent: false },
];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const page = await browser.newPage();
for (const job of jobs) {
  const svg = readFileSync(`${OUT}/${job.src}`, 'utf8');
  await page.setViewportSize({ width: job.size, height: job.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img style="display:block;width:${job.size}px;height:${job.size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`,
  );
  await page.screenshot({ path: `${OUT}/${job.out}`, omitBackground: job.transparent });
  console.log(`${OUT}/${job.out}`);
}
await browser.close();
