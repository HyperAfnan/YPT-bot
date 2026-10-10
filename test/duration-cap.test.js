import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clampDailyStudySeconds, MAX_DAILY_STUDY_SECONDS } from '../src/config/limits.js';

describe('MAX_DAILY_STUDY_SECONDS', () => {
  test('is exactly 14 hours in seconds', () => {
    assert.strictEqual(MAX_DAILY_STUDY_SECONDS, 50400);
  });
});

describe('clampDailyStudySeconds', () => {
  test('passes through durations under the cap', () => {
    assert.strictEqual(clampDailyStudySeconds(0), 0);
    assert.strictEqual(clampDailyStudySeconds(3600), 3600);
    assert.strictEqual(clampDailyStudySeconds(50399), 50399);
  });

  test('keeps the exact cap value unchanged', () => {
    assert.strictEqual(clampDailyStudySeconds(50400), 50400);
  });

  test('caps durations above 14 hours down to the cap', () => {
    assert.strictEqual(clampDailyStudySeconds(50401), 50400);
    assert.strictEqual(clampDailyStudySeconds(60000), 50400);
    assert.strictEqual(clampDailyStudySeconds(14 * 60 * 60 * 2), 50400);
  });

  test('floors negative and non-numeric inputs to 0', () => {
    assert.strictEqual(clampDailyStudySeconds(-1), 0);
    assert.strictEqual(clampDailyStudySeconds(-99999), 0);
    assert.strictEqual(clampDailyStudySeconds(undefined), 0);
    assert.strictEqual(clampDailyStudySeconds(null), 0);
    assert.strictEqual(clampDailyStudySeconds('abc'), 0);
    assert.strictEqual(clampDailyStudySeconds(NaN), 0);
  });

  test('floors fractional seconds', () => {
    assert.strictEqual(clampDailyStudySeconds(120.9), 120);
  });
});
