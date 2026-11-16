import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeWithRetryAndFallback,
  extractFriendlyGeminiError,
  isTransientGeminiError,
} from './geminiRetry';

test('isTransientGeminiError detects 503 high demand and 429 rate limit errors', () => {
  assert.equal(
    isTransientGeminiError(
      new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}')
    ),
    true
  );
  assert.equal(isTransientGeminiError(new Error('429 RESOURCE_EXHAUSTED')), true);
  assert.equal(isTransientGeminiError(new Error('400 Invalid audio format')), false);
});

test('executeWithRetryAndFallback retries transient 503 and falls back to secondary model', async () => {
  const calls: string[] = [];
  const delays: number[] = [];

  const { result, usedModel } = await executeWithRetryAndFallback({
    models: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
    maxRetriesPerModel: 1,
    baseDelayMs: 100,
    sleepFn: async (ms) => {
      delays.push(ms);
    },
    run: async (model) => {
      calls.push(model);
      if (model === 'gemini-4-hydrogen') {
        throw new Error('503 UNAVAILABLE high demand');
      }
      return 'ok-fallback';
    },
  });

  assert.equal(result, 'ok-fallback');
  assert.equal(usedModel, 'gemini-3.1-flash-lite');
  assert.deepEqual(calls, ['gemini-4-hydrogen', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
  assert.deepEqual(delays, [100]);
});

test('executeWithRetryAndFallback does not retry non-transient 400 errors', async () => {
  const calls: string[] = [];
  await assert.rejects(
    executeWithRetryAndFallback({
      models: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
      maxRetriesPerModel: 2,
      sleepFn: async () => {},
      run: async (model) => {
        calls.push(model);
        throw new Error('400 INVALID_ARGUMENT');
      },
    }),
    /INVALID_ARGUMENT/
  );
  assert.deepEqual(calls, ['gemini-4-hydrogen']);
});

test('extractFriendlyGeminiError converts raw 503 JSON error into clear Portuguese message', () => {
  const parsed = extractFriendlyGeminiError(
    new Error(
      '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'
    )
  );
  assert.equal(parsed.status, 503);
  assert.match(parsed.message, /pico momentâneo de demanda/i);
});
