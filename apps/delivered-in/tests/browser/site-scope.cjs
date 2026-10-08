// Run against a local Delivered-In server. Every operational API is mocked;
// no session, cloud credentials or operational persistence is used.
const assert = require('node:assert/strict');
const { chromium } = require('../../../logistics/node_modules/@playwright/test');
const base = process.env.DELIVERED_IN_TEST_URL || 'http://localhost:3800';
const sites = ['A', 'B', 'C'].map(value => ({ oplocId: `oploc:${value}`, label: `Site ${value}` }));
const head = id => ({ access: { email: 'isolated@local.fika', oplocIds: sites.map(site => site.oplocId), permissions: [] }, sites, selectedOplocId: id, entries: [], weeks: [], withdrawnServiceDates: [], unavailableServiceDates: [], projectionState: 'current' });
const reply = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const barrier = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const stage of ['head', 'body']) {
      const page = await browser.newPage(), blocked = barrier(), entered = barrier();
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()), id = url.searchParams.get('oplocId') || 'oploc:A';
        if (id === 'oploc:B' && (stage === 'head' || !url.searchParams.has('head'))) { entered.release(); await blocked.promise; }
        const body = head(id);
        if (id === 'oploc:B' && stage === 'body' && url.searchParams.has('head')) body.projectionState = 'partial';
        if (!url.searchParams.has('head')) body.weeks = [];
        await reply(route, body);
      });
      try {
        await page.goto(`${base}/?oplocId=oploc:A&week=2026-10-05`);
        await page.getByRole('combobox').selectOption('oploc:B');
        await entered.promise;
        assert.equal(await page.getByRole('combobox').count(), 0, 'prior-site selector/content hidden during authority resolution');
        await page.evaluate(() => { history.pushState(null, '', '/?oplocId=oploc:C&week=2026-10-05'); dispatchEvent(new PopStateEvent('popstate')); });
        await page.waitForFunction(() => document.querySelector('select')?.value === 'oploc:C');
        blocked.release();
        // Wait for the obsolete route to settle, then inspect after rendering.
        await page.waitForTimeout(250);
        assert.equal(await page.getByRole('combobox').inputValue(), 'oploc:C');
        assert.ok(decodeURIComponent(page.url()).includes('oploc:C'));
        console.log(`PASS late ${stage} response cannot overwrite a newer site`);
      } finally { blocked.release(); await page.close(); }
    }
    for (const result of ['denied', 'zero-access']) {
      const page = await browser.newPage();
      await page.route('**/api/**', async route => {
        const id = new URL(route.request().url()).searchParams.get('oplocId') || 'oploc:A';
        if (id === 'oploc:A') return reply(route, head(id));
        if (result === 'denied') return reply(route, { error: { message: 'Scope denied' } }, 403);
        return reply(route, { ...head(undefined), access: { email: 'isolated@local.fika', oplocIds: [], permissions: [] }, sites: [] });
      });
      try {
        await page.goto(`${base}/?oplocId=oploc:A&week=2026-10-05`);
        await page.getByRole('combobox').selectOption('oploc:B');
        await page.getByText(result === 'denied' ? 'This dashboard is temporarily unavailable. Please check back shortly.' : 'Your authenticated identity is not assigned to an authorised OPLOC.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('combobox').count(), 0);
        assert.equal(await page.getByRole('navigation').count(), 0);
        assert.equal(await page.getByText('Site A', { exact: true }).count(), 0);
        console.log(`PASS ${result} removes previous site, navigation and privileged content`);
      } finally { await page.close(); }
    }
    const page = await browser.newPage(), blocked = barrier(), entered = barrier();
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), id = url.searchParams.get('oplocId') || 'oploc:A';
      if (url.pathname.endsWith('/access')) return reply(route, head(id));
      if (url.pathname.endsWith('/catalogue')) return reply(route, { manifest: { dataset: 'grab-and-go', packageVersion: 1, schemaVersion: 1, contractVersion: 1, contentHash: id }, catalogue: { schemaVersion: 1, products: [{ productId: id, name: `Product ${id}`, category: 'grab_250ml', active: true, rotationWeeks: [1,2,3,4], allowedDeliveryWeekdays: ['Monday'], sortOrder: 1 }] } });
      if (id === 'oploc:B') { entered.release(); await blocked.promise; }
      return reply(route, { deliveryDates: [{ date: '2026-10-12', weekday: 'Monday', rotationWeek: 4 }], orders: [], suggestedLinesByDate: {}, cutoffHour: 12 });
    });
    try {
      await page.goto(`${base}/grab-and-go?oplocId=oploc:A`);
      await page.getByRole('button', { name: 'Increase Product oploc:A' }).waitFor();
      await page.getByRole('combobox').selectOption('oploc:B'); await entered.promise;
      assert.equal(await page.getByRole('button', { name: 'Increase Product oploc:A' }).count(), 0, 'old site basket is hidden immediately');
      await page.getByRole('combobox').selectOption('oploc:C');
      await page.getByRole('button', { name: 'Increase Product oploc:C' }).waitFor();
      blocked.release(); await page.waitForTimeout(250);
      assert.equal(await page.getByRole('button', { name: 'Increase Product oploc:B' }).count(), 0);
      assert.equal(await page.getByRole('combobox').inputValue(), 'oploc:C');
      assert.ok(decodeURIComponent(page.url()).includes('oploc:C'));
      console.log('PASS Grab & Go isolates basket/loading/late responses and keeps the selected site URL');
    } finally { blocked.release(); await page.close(); }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
