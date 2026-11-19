import assert from 'node:assert/strict';
import { test } from 'node:test';
import { housingTaxes, housingTaxSource, parseWozEuros } from '../src/features/housing/taxes.ts';

test('Amsterdam 2026 owner calculation uses residential OZB, fixed sewer and household waste', () => {
  const estimate = housingTaxes({ tenure: 'owner', household: 'single', woz: '500000' });
  assert.deepEqual(estimate, { ozbCents: 26350, sewerCents: 19204, wasteCents: 35200, totalCents: 80754, monthlyCents: 6730 });
  assert.equal(housingTaxes({ tenure: 'owner', household: 'multiple', woz: '500000' }).totalCents, 92454);
  assert.equal(housingTaxSource.year, 2026);
});

test('tenants need no WOZ and pay neither residential owner OZB nor owner sewer charge', () => {
  assert.deepEqual(housingTaxes({ tenure: 'tenant', household: 'single', woz: '' }), { ozbCents: 0, sewerCents: 0, wasteCents: 35200, totalCents: 35200, monthlyCents: 2933 });
  assert.equal(housingTaxes({ tenure: 'tenant', household: 'multiple', woz: '' }).totalCents, 46900);
});

test('tax WOZ uses the same Dutch number notation as housing filters', () => {
  const estimate = housingTaxes({ tenure: 'owner', household: 'single', woz: '500000' });
  for (const woz of ['500000', '500.000', '500.000,00', ' 500.000 ']) {
    assert.equal(parseWozEuros(woz), 500000, woz);
    assert.deepEqual(housingTaxes({ tenure: 'owner', household: 'single', woz }), estimate, woz);
  }
  assert.equal(parseWozEuros('500,000'), 500, 'A comma is the decimal separator');
});

test('missing, invalid, non-positive or unsafe values cannot yield an owner total', () => {
  for (const woz of ['', ' ', '0', '-1', 'NaN', 'Infinity', '50.00.00', '500,000.00', '1e6', '500000.50', '500.000,50', '9007199254740991']) {
    assert.equal(parseWozEuros(woz), null, woz);
    assert.equal(housingTaxes({ tenure: 'owner', household: 'single', woz }), null, woz);
  }
  assert.equal(parseWozEuros(' 500000 '), 500000);
  assert.equal(housingTaxes({ tenure: 'other', household: 'single', woz: '500000' }), null);
  assert.equal(housingTaxes({ tenure: 'owner', household: 'other', woz: '500000' }), null);
});

test('OZB rounds to cents before summing rather than compounding rounding in the subtotal', () => {
  const estimate = housingTaxes({ tenure: 'owner', household: 'single', woz: '123456' });
  assert.equal(estimate.ozbCents, 6506);
  assert.equal(estimate.totalCents, estimate.ozbCents + estimate.sewerCents + estimate.wasteCents);
  assert.equal(estimate.monthlyCents, Math.round(estimate.totalCents / 12));
});

test('OZB uses integer rate arithmetic and rounds an exact half cent upwards', () => {
  assert.equal(housingTaxes({ tenure: 'owner', household: 'single', woz: '75.000' }).ozbCents, 3953);
});
