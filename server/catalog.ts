import type { Catalog, CatalogVariant, ConfigurationPage, Family } from './types';
import type { Dimension } from '../src/types';
import { record, text, stringRecord } from './json';
type RawVariant = Omit<CatalogVariant, 'label'> & { label?: string };
// Discovers every standard configuration of a product family from Apple's own store pages.
// A configuration is: base part number (same across stores for most products) + dimensions.
import { load } from 'cheerio';
import { appleText, storeUrl, extractObject, plainText, basePart } from './apple.ts';

import { families, familyById } from './families.ts';
export { families, familyById };

const dimensionNames: Record<string, string> = {
  screensize: 'Size',
  color: 'Color',
  finish: 'Display',
  chip: 'Chip',
  capacity: 'Storage',
  connection: 'Connectivity',
  casesize: 'Case size',
  casematerial: 'Material',
  standtype: 'Stand',
  'cpucorecount-gpucorecount': 'Cores',
  'chip-cpucorecount-gpucorecount': 'Cores',
  memory: 'Memory',
  storage: 'Storage',
  cpu: 'CPU',
  gpu: 'GPU',
  other: 'Other',
};
export const dimensionKey = (raw: string) =>
  raw
    .replace(/^.*?dimension/i, '')
    .replace(/^(processor|storage|chassis|watch_cases)-/, '')
    .toLowerCase() || raw.toLowerCase();
const dimensionName = (key: string) =>
  dimensionNames[key] || key.replace(/(^|-)(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());
const humanize = (value: unknown) =>
  String(value)
    .replace(/^(\d+)_(\d)inch$/, '$1.$2-inch')
    .replace(/^(\d+)inch$/, '$1-inch')
    .replace(/^(\d+)(gb|tb)$/i, (_, n, u) => n + u.toUpperCase())
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
const dimensionOrder = [
  'size',
  'screensize',
  'casesize',
  'chip',
  'cpu',
  'gpu',
  'cores',
  'cpucorecount-gpucorecount',
  'chip-cpucorecount-gpucorecount',
  'memory',
  'storage',
  'capacity',
  'display',
  'finish',
  'connection',
  'standtype',
  'casematerial',
  'color',
];
const dimensionRank = (key: string) => {
  const i = dimensionOrder.indexOf(key);
  return i < 0 ? dimensionOrder.length - 1 : i;
};
// Numeric order for sizes/capacities/cores, and M5 < M5 Pro < M5 Max < M5 Ultra for chips.
function valueRank(label: string, key: string) {
  const chip = String(label).match(/^M(\d+)(?: (Pro|Max|Ultra))?$/);
  if (chip) return +chip[1] * 10 + ['', 'Pro', 'Max', 'Ultra'].indexOf(chip[2] || '');
  const m =
    String(label).match(/^([\d.]+)\s*(GB|TB|mm|-inch|-core)?\b/i) ||
    String(key)
      .replace(/^(\d+)_(\d)/, '$1.$2')
      .match(/^([\d.]+)(gb|tb|mm|inch)?/i);
  return m ? +m[1] * (m[2]?.toUpperCase() === 'TB' ? 1024 : 1) : NaN;
}
const slug = (s: unknown) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/\.(?!\d)|(?<!\d)\./g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
const image = (name: string, size = 1200) =>
  `https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/${name}?wid=${size}&hei=${size}&fmt=png-alpha`;

function label(displayValues: Record<string, unknown>, raw: string, value: string) {
  const entry = record(displayValues[raw])[value];
  const text =
    typeof entry === 'string'
      ? entry
      : (record(entry).header ?? record(entry).value ?? record(entry).text ?? null);
  const line =
    typeof text === 'string'
      ? plainText(text)
          .split('\n')
          .map((s) => s.trim())
          .find(Boolean)
      : null;
  return line && line.length <= 40 ? line.replace(/\s+(storage|model)$/i, '') : humanize(value);
}

// Shape 1/2: bootstrap `products` carrying dimensions either nested (`dimensions:{}`) or flat (`dimensionColor`).
export function bootstrapConfigurations(input: unknown): RawVariant[] {
  const data = record(input);
  const displayValues = { ...record(data.mainDisplayValues), ...record(data.displayValues) };
  const rows = [];
  for (const inputProduct of Array.isArray(data.products) ? data.products : []) {
    const product = record(inputProduct);
    if (product.carrierPolicyType && product.carrierPolicyType !== 'UNLOCKED') continue; // keep unlocked phones only
    if (product.isCarrierDevice) continue;
    const part =
      text(product.btrOrFdPartNumber) ||
      text(product.partNumber) ||
      (/^M\w{4}/.test(text(product.part) || '') ? text(product.part) : undefined);
    if (!part) continue;
    const dims = product.dimensions
      ? stringRecord(product.dimensions)
      : Object.fromEntries(
          Object.entries(stringRecord(product)).filter(
            ([k, v]) => /^dimension(?!Steporder)/.test(k) && typeof v === 'string',
          ),
        );
    // Apple nests chip + cores; the cores key already implies the chip, but both are useful selectors.
    rows.push({
      part: basePart(part),
      raw: dims,
      imageKey: text(product.imageKey),
      seo: text(product.seoUrlToken),
    });
  }
  const order = [...new Set(rows.flatMap((r) => Object.keys(r.raw)))];
  const seen = new Set(),
    variants: RawVariant[] = [];
  for (const row of rows) {
    const specs: Record<string, string> = {},
      labels: Record<string, string> = {};
    for (const raw of order) {
      const value = row.raw[raw];
      if (value == null) continue;
      const key = dimensionKey(raw);
      specs[key] = value;
      labels[key] = label(displayValues, raw, value);
    }
    const signature = JSON.stringify(specs);
    if (seen.has(signature)) continue;
    seen.add(signature);
    variants.push({
      id: slug(row.seo?.replace(/-unlocked$/, '') || Object.values(labels).join(' ')),
      part: row.part,
      specs,
      labels,
      image:
        row.imageKey && !/^M\w{4}$/.test(row.imageKey)
          ? image(row.imageKey)
          : row.imageKey
            ? image(row.imageKey, 800)
            : null,
    });
  }
  return variants;
}

// Shape 3 (Mac): Apple's list of standard configurations with a readable spec line per item.
const macToken: [RegExp, string][] = [
  [/-inch|-zoll|inch/i, 'size'],
  [/chip$/i, 'chip'],
  [/core cpu$/i, 'cpu'],
  [/core gpu$/i, 'gpu'],
  [/memory$/i, 'memory'],
  [/storage$|^\d+\s?(GB|TB)$/i, 'storage'],
  [/display$|glass$/i, 'display'],
  [/stand$|vesa/i, 'stand'],
  [/ethernet|thunderbolt|power adapter|keyboard|touch id|magic/i, 'other'],
];
export function parseMacSpecLine(line: string) {
  const [, ...tokens] = line.replace(/\u00a0/g, ' ').split(/,\s*/);
  const specs: Record<string, string> = {};
  for (const token of tokens) {
    const key = macToken.find(([re]) => re.test(token))?.[1] || 'color';
    specs[key] = specs[key] ? specs[key] + ', ' + token : token;
  }
  for (const key of ['memory', 'storage'])
    if (specs[key]) specs[key] = specs[key].replace(/\s*(unified\s+)?(memory|storage)$/i, '');
  if (specs.chip) specs.chip = specs.chip.replace(/\s*chip$/i, '').replace(/^Apple\s+/, '');
  for (const key of ['cpu', 'gpu'])
    if (specs[key])
      specs[key] = specs[key].replace(/\s*(CPU|GPU)$/, '').replace(/^(\d+)-core$/i, '$1-core');
  return specs;
}
export function macListConfigurations(html: string) {
  const $ = load(html),
    items: { url: string; line: string }[] = [];
  $('div.item a[href*="/shop/buy-mac/"]').each((_, a) => {
    const url = ($(a).attr('href') || '').trim();
    const line = $(a).find('.details').text().trim() || $(a).text().trim();
    if (line.includes(',')) items.push({ url, line });
  });
  return items;
}
async function macConfigurationPage(url: string): Promise<ConfigurationPage | null> {
  const $ = load(await appleText(url));
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = record(JSON.parse($(el).text()));
      if (data['@type'] === 'Product') {
        const offer = record(Array.isArray(data.offers) ? data.offers[0] : data.offers);
        return {
          part: basePart(offer?.sku),
          image: text(data.image)?.replace(/wid=\d+&hei=\d+/, 'wid=1200&hei=770'),
        };
      }
    } catch {}
  }
  return null;
}

export async function discoverFamily(
  family: Family,
  {
    pageCache = (_url, loader) => loader(),
    fetchPage = appleText,
  }: {
    pageCache?: (
      url: string,
      loader: () => Promise<ConfigurationPage | null>,
    ) => Promise<ConfigurationPage | null>;
    fetchPage?: (url: string) => Promise<string>;
  } = {},
): Promise<Catalog> {
  const pageUrl = storeUrl('', 'shop/' + family.path);
  const html = await fetchPage(pageUrl);
  const data = record(extractObject(html, 'productSelectionData:'));
  const familyImage =
    (html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || '').replace(/&amp;/g, '&') ||
    null;
  let variants: RawVariant[] = [];
  const list = family.category === 'Mac' ? macListConfigurations(html) : [];
  if (list.length) {
    const pages: ConfigurationPage[] = [];
    for (const item of list) {
      const url = new URL(item.url, pageUrl).href;
      const page = await pageCache(url, () => macConfigurationPage(url));
      if (!page?.part) throw new Error(`Incomplete configuration data for ${family.id}`);
      pages.push(page);
    }
    list.forEach((item, i) => {
      const page = pages[i];
      if (!page?.part) return;
      const labels = parseMacSpecLine(item.line);
      variants.push({
        id: slug(item.url.split('/').pop()),
        part: page.part,
        specs: { ...labels },
        labels,
        image: page.image || familyImage,
        name: item.line,
      });
    });
  }
  if (!variants.length && data) variants = bootstrapConfigurations(data);
  if (!variants.length) throw new Error(`No configurations found for ${family.id}`);
  const dimensions: Dimension[] = [];
  for (const v of variants)
    for (const [key, value] of Object.entries(v.specs)) {
      let dim = dimensions.find((d) => d.key === key);
      if (!dim) dimensions.push((dim = { key, name: dimensionName(key), values: [] }));
      if (!dim.values.some((x) => x.key === value))
        dim.values.push({ key: value, label: v.labels[key] });
    }
  for (const dim of dimensions)
    if (dim.key !== 'color') {
      const rank = (v: { label: string; key: string }) => valueRank(v.label, v.key);
      if (dim.values.every((v) => !isNaN(rank(v)))) dim.values.sort((a, b) => rank(a) - rank(b));
    }
  dimensions.sort((a, b) => dimensionRank(a.key) - dimensionRank(b.key));
  for (const v of variants) {
    v.label = Object.values(v.labels).join(' · ');
    v.image ??= familyImage;
  }
  return {
    ...family,
    url: pageUrl,
    image: familyImage,
    dimensions: dimensions.filter((d) => d.values.length > 1 || dimensions.length === 1),
    fixed: Object.fromEntries(
      dimensions.filter((d) => d.values.length === 1).map((d) => [d.name, d.values[0].label]),
    ),
    variants: variants.map((v) => ({
      ...v,
      label: v.label || Object.values(v.labels).join(' · '),
    })),
    discoveredAt: new Date().toISOString(),
  };
}

// Regional stores sometimes sell different part numbers (e.g. iPhone models per region). Map them by dimensions.
export async function regionalParts(
  family: Family,
  store: string,
): Promise<Record<string, string>> {
  const html = await appleText(storeUrl(store, 'shop/' + family.path));
  const data = record(extractObject(html, 'productSelectionData:'));
  if (!data) return {};
  const byDims = new Map();
  for (const inputProduct of Array.isArray(data.products) ? data.products : []) {
    const product = record(inputProduct);
    if (
      (product.carrierPolicyType && product.carrierPolicyType !== 'UNLOCKED') ||
      product.isCarrierDevice
    )
      continue;
    const part = text(product.btrOrFdPartNumber) || text(product.partNumber);
    if (!part) continue;
    const dims =
      (product.dimensions ? stringRecord(product.dimensions) : undefined) ||
      Object.fromEntries(
        Object.entries(stringRecord(product)).filter(
          ([k, v]) => /^dimension(?!Steporder)/.test(k) && typeof v === 'string',
        ),
      );
    const key = specSignature(
      Object.fromEntries(Object.entries(dims).map(([k, v]) => [dimensionKey(k), v])),
    );
    if (!byDims.has(key)) byDims.set(key, basePart(part));
  }
  return Object.fromEntries(byDims); // plain object so it can be cached as JSON
}
export const specSignature = (specs: Record<string, string>) =>
  JSON.stringify(Object.entries(specs).sort());
