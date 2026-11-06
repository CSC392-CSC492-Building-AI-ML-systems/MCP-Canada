import test from 'node:test';
import assert from 'node:assert/strict';
import { affordability } from '../src/components/explorer/affordability.ts';
test('income share and exact monthly budget boundary', () => {
  const r = affordability(1800, '72000', '1800');
  assert.equal(r.incomeShare, 30);
  assert.equal(r.monthlyLimit, 1800);
  assert.equal(r.withinBudget, true);
  assert.equal(r.meetsGuideline, true);
  assert.equal(affordability(1800.01, '72000', '1800').withinBudget, false);
});
test('missing cost stays unknown, including with valid income', () => {
  const r = affordability(null, '72000', '1800');
  assert.equal(r.incomeShare, null);
  assert.equal(r.withinBudget, null);
  assert.equal(r.meetsGuideline, null);
});
test('zero income is invalid and zero observed cost is valid', () => {
  assert.ok(affordability(1000, '0', '').incomeError);
  assert.equal(affordability(1000, '0', '').incomeShare, null);
  assert.equal(affordability(0, '72000', '0').withinBudget, true);
  assert.equal(affordability(0, '72000', '').incomeShare, 0);
});
test('invalid, blank and non-finite personal inputs never yield a score', () => {
  for (const income of ['', ' ', 'NaN', '-1', 'Infinity']) assert.equal(affordability(1000, income, '').incomeShare, null);
  assert.ok(affordability(1000, '72000', '-1').budgetError);
  assert.equal(affordability(-1, '72000', '1800').incomeShare, null);
});
