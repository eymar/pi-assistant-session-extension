// Non-zero inherited usage, including provider-reported cost and optional tokens.
export const billedUsage = () => ({
  input: 100, output: 20, cacheRead: 30, cacheWrite: 10,
  cacheWrite1h: 5, reasoning: 8, totalTokens: 160,
  cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.5, totalFromProvider: true },
});
export const assistantMessage = (usage = billedUsage()) => ({
  role: 'assistant', content: [{ type: 'text', text: 'inherited finding' }],
  api: 'openai-completions', provider: 'review-test', model: 'primary',
  usage, stopReason: 'stop', timestamp: 0,
});
