/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers for Droid SDK MCP startup sync.
 *
 * Responsibility: given (a) a list of MCP servers that the user / team has
 * configured to be enabled for this workspace and (b) the list of MCP servers
 * the live Droid SDK session already knows about, compute which entries are
 * missing and need to be registered via `session.addMcpServer(...)`.
 *
 * Hard constraints (see `.factory/skills/droid-sdk-integration/SKILL.md` and
 * `references/gaps-and-guidance.md` P1-1):
 * - **Pure functions only**. No IPC, no storage, no SDK runtime imports.
 *   `AcpAgentManager` / `McpService` MUST NOT import `@factory/droid-sdk`
 *   runtime APIs — this module only uses type imports.
 * - **Never throw on unknown shapes**. Caller invokes this in a best-effort
 *   `syncMcpServersOnStartup` path; a failure must degrade gracefully.
 * - **No `remove` direction**. We do NOT reconcile "servers that exist in the
 *   session but not in the desired list" — those are managed by their original
 *   source (UI / team sync), and silently removing them here would stomp on
 *   user intent.
 *
 * 为什么要这个模块：
 * - `DroidSdkAgent.syncMcpServersOnStartup` 会在 session 启动后对比"应当启用"
 *   与"SDK 已存在"的 MCP 列表，补齐缺失项；逻辑纯、可独立单测。
 * - AcpAgentManager 把 team/project MCP 配置拍扁成 DesiredMcpServer[] 传进来，
 *   避免外部文件依赖 SDK 运行期类型。
 */

import type { AddMcpServerRequestParams } from '@factory/droid-sdk';

/**
 * MCP server "desired state" — the plain shape that external callers
 * (AcpAgentManager, McpService adapters) pass in. Deliberately does NOT reuse
 * `AddMcpServerRequestParams` directly so callers don't need to import SDK
 * types; the mapper below converts it.
 *
 * MCP 期望状态的宿主无关描述。外部代码用这个结构传入，避免引入 SDK 运行期依赖。
 */
export interface DesiredMcpServer {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Drop invalid entries and ones with no `name`. Keeps the rest of the sync
 * pipeline simple — downstream code can assume every entry has a usable name.
 */
export function normalizeDesiredMcpServers(input: unknown): DesiredMcpServer[] {
  if (!Array.isArray(input)) return [];
  const result: DesiredMcpServer[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Partial<DesiredMcpServer>;
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) continue;
    const type =
      candidate.type === 'stdio' || candidate.type === 'http' || candidate.type === 'sse' ? candidate.type : null;
    if (!type) continue;
    const entry: DesiredMcpServer = { name: candidate.name, type };
    if (typeof candidate.command === 'string') entry.command = candidate.command;
    if (Array.isArray(candidate.args)) {
      entry.args = candidate.args.filter((item): item is string => typeof item === 'string');
    }
    if (candidate.env && typeof candidate.env === 'object') {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(candidate.env)) {
        if (typeof key === 'string' && typeof value === 'string') env[key] = value;
      }
      if (Object.keys(env).length > 0) entry.env = env;
    }
    if (typeof candidate.url === 'string') entry.url = candidate.url;
    if (candidate.headers && typeof candidate.headers === 'object') {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(candidate.headers)) {
        if (typeof key === 'string' && typeof value === 'string') headers[key] = value;
      }
      if (Object.keys(headers).length > 0) entry.headers = headers;
    }
    result.push(entry);
  }
  return result;
}

/**
 * Return the subset of `desired` whose `name` is NOT in `existingNames`.
 * Deduplicates desired entries by name (first-wins) before diffing.
 *
 * 对比 desired 与 existingNames，返回 desired 侧多出来的条目（需要 addMcpServer）。
 * desired 重名时保留第一次出现的那条。
 */
export function diffMissingMcpServers(
  desired: DesiredMcpServer[],
  existingNames: Iterable<string>
): DesiredMcpServer[] {
  const existingSet = new Set<string>();
  for (const name of existingNames) {
    if (typeof name === 'string' && name.length > 0) existingSet.add(name);
  }
  const seen = new Set<string>();
  const missing: DesiredMcpServer[] = [];
  for (const server of desired) {
    if (!server.name || seen.has(server.name)) continue;
    seen.add(server.name);
    if (existingSet.has(server.name)) continue;
    missing.push(server);
  }
  return missing;
}

/**
 * Transform a `DesiredMcpServer` into the exact shape expected by
 * `DroidSession.addMcpServer(...)`. The SDK requires stdio servers to carry
 * `command`; http / sse servers to carry `url`. Returns `null` when the
 * mandatory field is missing so the caller can skip the entry instead of
 * crashing the sync.
 *
 * 把 DesiredMcpServer 翻译成 SDK `addMcpServer` 所需参数。对 stdio 强制 command、
 * 对 http/sse 强制 url；字段不全则返回 null 让调用方跳过。
 */
export function toAddMcpServerParams(server: DesiredMcpServer): AddMcpServerRequestParams | null {
  const base: Partial<AddMcpServerRequestParams> = {
    name: server.name,
    type: server.type as AddMcpServerRequestParams['type'],
  };
  if (server.type === 'stdio') {
    if (!server.command) return null;
    base.command = server.command;
    if (server.args && server.args.length > 0) base.args = server.args;
    if (server.env && Object.keys(server.env).length > 0) base.env = server.env;
  } else {
    if (!server.url) return null;
    base.url = server.url;
    if (server.headers && Object.keys(server.headers).length > 0) base.headers = server.headers;
  }
  return base as AddMcpServerRequestParams;
}
