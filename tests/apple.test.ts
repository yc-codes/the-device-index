import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractObject, plainText, basePart } from '../server/apple.ts';
import {
  parseMacSpecLine,
  bootstrapConfigurations,
  macListConfigurations,
  discoverFamily,
} from '../server/catalog.ts';
test('reads Apple bootstrap objects embedded in scripts', () => {
  const html =
    '<script>window.X = { productSelectionData: {"a":"}{\\"","b":{"c":[1,2]}}, other: 1 };</script>';
  assert.deepEqual(extractObject(html, 'productSelectionData:'), { a: '}{"', b: { c: [1, 2] } });
  assert.equal(extractObject(html, 'missing:'), null);
});
test('display discovery resolves relative configuration links before caching and fetching', async () => {
  for (const id of ['studio-display', 'studio-display-xdr']) {
    const configuration = `/shop/buy-mac/${id}/standard-glass-vesa-mount-adapter`;
    for (const href of [configuration, `https://www.apple.com${configuration}`]) {
      const requested: string[] = [];
      const catalog = await discoverFamily(
        { id, name: 'Studio Display', category: 'Mac', path: `buy-mac/${id}` },
        {
          fetchPage: async () =>
            `<div class="item"><a href="${href}"><div class="details">Studio Display, Standard glass, VESA mount adapter</div></a></div>`,
          pageCache: async (url) => {
            requested.push(url);
            return { part: 'TEST1' };
          },
        },
      );
      assert.deepEqual(requested, [`https://www.apple.com${configuration}`]);
      assert.equal(catalog.variants.length, 1);
      assert.equal(catalog.variants[0].id, 'standard-glass-vesa-mount-adapter');
      assert.equal(catalog.variants[0].part, 'TEST1');
    }
  }
});
test('strips Apple markup, footnotes and badges from labels', () => {
  assert.equal(
    plainText(
      '<span class="badge badge-tiny">New</span><div>Titanium</div><span class="form-label-small">Comes with GPS</span>',
    )
      .split('\n')
      .find(Boolean),
    'Titanium',
  );
  assert.equal(
    plainText('256<small>GB</small><as-footnote data-id="x"><sup>1</sup></as-footnote>'),
    '256GB',
  );
  assert.equal(basePart('MGE74LL/A'), 'MGE74');
  assert.equal(basePart('MJFN4LS/A'), 'MJFN4');
  assert.equal(basePart('MGE74'), 'MGE74');
});
test('parses Mac standard-configuration spec lines', () => {
  assert.deepEqual(
    parseMacSpecLine(
      'MacBook Pro, 16-inch, M5 Max Chip, 18-core CPU, 32-core GPU, Silver, Standard display, 36GB memory, 2TB storage',
    ),
    {
      size: '16-inch',
      chip: 'M5 Max',
      cpu: '18-core',
      gpu: '32-core',
      color: 'Silver',
      display: 'Standard display',
      memory: '36GB',
      storage: '2TB',
    },
  );
  assert.deepEqual(parseMacSpecLine('MacBook Neo, Blush, 256GB'), {
    color: 'Blush',
    storage: '256GB',
  });
  const html =
    '<div class="item"><a href=" https://www.apple.com/shop/buy-mac/macbook-pro/x "><div class="details">MacBook Pro, 14-inch, Silver</div></a></div>';
  assert.deepEqual(macListConfigurations(html), [
    {
      url: 'https://www.apple.com/shop/buy-mac/macbook-pro/x',
      line: 'MacBook Pro, 14-inch, Silver',
    },
  ]);
});
test('bootstrap products become unlocked configurations with labels', () => {
  const data = {
    displayValues: {
      dimensionColor: { silver: 'Silver' },
      dimensionCapacity: { '256gb': '256<small>GB</small>' },
    },
    products: [
      {
        partNumber: 'MJWE4LL/A',
        dimensionColor: 'silver',
        dimensionCapacity: '256gb',
        carrierPolicyType: 'UNLOCKED',
        seoUrlToken: '256gb-silver-unlocked',
        imageKey: 'iphone-silver',
      },
      {
        partNumber: 'MJWC4LL/A',
        dimensionColor: 'silver',
        dimensionCapacity: '256gb',
        carrierPolicyType: 'POSTPAID',
      },
      { part: 'MJFN4LS/A', dimensions: { 'watch_cases-dimensionCaseSize': '42mm' }, priceKey: 'x' },
    ],
  };
  const [phone, watch] = bootstrapConfigurations(data);
  assert.equal(phone.part, 'MJWE4');
  assert.equal(phone.id, '256gb-silver');
  assert.deepEqual(phone.labels, { color: 'Silver', capacity: '256GB' });
  assert.equal(watch.part, 'MJFN4');
  assert.deepEqual(watch.specs, { casesize: '42mm' });
});
test('decodes decimal and hexadecimal HTML entities without crashing on invalid ones', () => {
  assert.equal(plainText('Mac&#x20;Pro&#32;M5'), 'Mac Pro M5');
  assert.equal(plainText('&#xZZ;'), '&#xZZ;');
});
