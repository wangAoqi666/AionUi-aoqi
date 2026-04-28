/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalise an upstream backend error string so the UI surfaces a consistent,
 * user-actionable message. Currently rewrites the two known flavors of
 * credit-exhaustion reported by Factory (`402 Payment Required` and plain
 * `Payment Required`) into a single Chinese prompt that points at the billing
 * page. Pass-through for any other error so BYOK backends can report their
 * own text verbatim (HTTP status / rate-limit / provider disallowed etc.).
 *
 * Shared by:
 *   - `messageMapper.mapError`      — error events emitted by `session.stream()`
 *   - `DroidSdkAgent.handleMappedNotification` — error notifications pushed
 *     over `session.onNotification`. Both paths used to format the message
 *     independently; consolidating here prevents drift.
 */
export function normalizeBackendErrorMessage(message: string | undefined | null): string {
  const raw = typeof message === 'string' ? message.trim() : '';
  const text = raw || 'Unknown error';
  if (text.includes('402') || /payment required/i.test(text)) {
    return 'Factory 算力额度不足，请前往 https://app.factory.ai/settings/usage 充值后继续使用。';
  }
  return text;
}
