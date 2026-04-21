/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACP Skill Manager - 为 ACP agents (Claude/OpenCode/Codex) 提供 skills 按需加载能力
 * 借鉴 aioncli-core 的 SkillManager 设计
 *
 * ACP Skill Manager - Provides on-demand skill loading for ACP agents (Claude/OpenCode/Codex)
 * Inspired by aioncli-core's SkillManager design
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { getSkillsDir, getBuiltinSkillsCopyDir, getAutoSkillsDir } from '@process/utils/initStorage';
import { ExtensionRegistry } from '@process/extensions';

/**
 * Skill 定义（与 aioncli-core 兼容）
 * Skill definition (compatible with aioncli-core)
 */
export interface SkillDefinition {
  /** 技能唯一名称 / Unique skill name */
  name: string;
  /** 技能描述（用于索引）/ Skill description (for indexing) */
  description: string;
  /** 文件路径 / File path */
  location: string;
  /** 完整内容（延迟加载）/ Full content (lazy loaded) */
  body?: string;
}

/**
 * Skill 索引（轻量级，用于首条消息注入）
 * Skill index (lightweight, for first message injection)
 */
export interface SkillIndex {
  name: string;
  description: string;
}

/**
 * SDK skill 的分类。默认 `skill`；命中 custom-droid / subagent 约定时为 `subagent`。
 * Kind of an SDK-sourced skill: regular skill, or subagent-like (custom droid / Task).
 */
export type SdkSkillKind = 'skill' | 'subagent';

/**
 * SDK skill 的来源位置。与 `@factory/droid-sdk` 的 `SkillLocation`（project / personal / builtin）保持同步，
 * 以 string union 声明避免在 AcpSkillManager 里引入 SDK 运行期依赖（types-only 约束）。
 * SDK-reported skill location (kept as a string union so we don't require a runtime
 * dependency on `@factory/droid-sdk` here — only DroidSdkAgent may import that module).
 */
export type SdkSkillLocation = 'project' | 'personal' | 'builtin' | (string & {});

/**
 * Droid SDK `session.listSkills()` 返回结果在本项目中的规范化形式。
 * Normalized record for skills returned by Droid SDK `session.listSkills()`.
 *
 * 与 `SkillDefinition` 的差异：
 * - `kind` 区分 subagent / 普通 skill 以便 UI 标识
 * - `location` 使用 SDK 的 location 枚举语义（而非本地文件路径）
 * - `filePath` 记录 SDK 报告的 skill 源文件，方便排障
 */
export interface SdkSkill {
  name: string;
  description: string;
  location: SdkSkillLocation;
  filePath: string;
  kind: SdkSkillKind;
  enabled?: boolean;
  userInvocable?: boolean;
  version?: string;
}

/**
 * 解析 SKILL.md 的 frontmatter
 * Parse frontmatter from SKILL.md
 */
function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  const result: { name?: string; description?: string } = {};

  // 解析 name
  const nameMatch = frontmatter.match(/^name:\s*['"]?([^'"\n]+)['"]?\s*$/m);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  // 解析 description（支持单引号、双引号、无引号）
  const descMatch = frontmatter.match(/^description:\s*['"]?(.+?)['"]?\s*$/m);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }

  return result;
}

/**
 * 移除 frontmatter，只保留 body 内容
 * Remove frontmatter, keep only body content
 */
function extractBody(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
}

/**
 * ACP Skill Manager
 * 为 ACP agents 提供 skills 的索引加载和按需获取能力
 *
 * 使用单例模式避免重复文件系统扫描
 * Uses singleton pattern to avoid repeated filesystem scans
 *
 * 支持两类 skills:
 * - 内置 skills (_builtin/): 所有场景自动注入
 * - 可选 skills: 通过 enabledSkills 参数控制
 */
export class AcpSkillManager {
  private static instance: AcpSkillManager | null = null;
  private static instanceKey: string | null = null;

  private skills: Map<string, SkillDefinition> = new Map();
  private autoSkills: Map<string, SkillDefinition> = new Map();
  /** Extension-contributed skills loaded from ExtensionRegistry */
  private extensionSkills: Map<string, SkillDefinition> = new Map();
  /**
   * Skills surfaced by Droid SDK `session.listSkills()`.
   * Droid 后端通过 `DroidSdkAgent.syncSdkSkills()` 在会话启动后 merge 进来，
   * 关闭会话时清空。详见 `droid-sdk-integration` skill 的 P0-1 / P0-4 指引。
   */
  private sdkSkills: Map<string, SdkSkill> = new Map();
  private skillsDir: string;
  private autoSkillsDir: string;
  private initialized: boolean = false;
  private autoInitialized: boolean = false;
  private extensionInitialized: boolean = false;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || getSkillsDir();
    this.autoSkillsDir = getAutoSkillsDir();
  }

  /**
   * 获取单例实例（带 enabledSkills 缓存键）
   * Get singleton instance (with enabledSkills cache key)
   *
   * @param enabledSkills - 启用的 skills 列表，用作缓存键 / Enabled skills list, used as cache key
   * @returns AcpSkillManager 实例 / AcpSkillManager instance
   */
  static getInstance(enabledSkills?: string[]): AcpSkillManager {
    const cacheKey = enabledSkills?.toSorted().join(',') || 'all';

    // 如果缓存键变化，需要重新创建实例
    // If cache key changed, need to recreate instance
    if (AcpSkillManager.instance && AcpSkillManager.instanceKey === cacheKey) {
      return AcpSkillManager.instance;
    }

    // 创建新实例
    AcpSkillManager.instance = new AcpSkillManager();
    AcpSkillManager.instanceKey = cacheKey;
    return AcpSkillManager.instance;
  }

  /**
   * 重置单例实例（用于测试或配置变更）
   * Reset singleton instance (for testing or config changes)
   */
  static resetInstance(): void {
    AcpSkillManager.instance = null;
    AcpSkillManager.instanceKey = null;
  }

  /**
   * 使单例缓存失效，下次 getInstance + discoverSkills 时重新扫描文件系统
   * Invalidate singleton cache so the next getInstance + discoverSkills re-scans
   */
  static invalidate(): void {
    if (AcpSkillManager.instance) {
      AcpSkillManager.instance.initialized = false;
      AcpSkillManager.instance.autoInitialized = false;
    }
  }

  /**
   * 初始化：发现并加载内置 skills 的索引（所有场景自动注入）
   * Initialize: discover and load index of builtin skills (auto-injected for all scenarios)
   */
  async discoverAutoSkills(): Promise<void> {
    if (this.autoInitialized) return;

    const builtinDir = this.autoSkillsDir;
    if (!existsSync(builtinDir)) {
      console.log(`[AcpSkillManager] Builtin skills directory not found: ${builtinDir}`);
      this.autoInitialized = true;
      return;
    }

    try {
      const entries = await fs.readdir(builtinDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const skillName = entry.name;
        const skillFile = path.join(builtinDir, skillName, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        try {
          const content = await fs.readFile(skillFile, 'utf-8');
          const { name, description } = parseFrontmatter(content);

          const skillDef: SkillDefinition = {
            name: name || skillName,
            description: description || `Builtin Skill: ${skillName}`,
            location: skillFile,
            // body 不在这里加载，按需获取
          };

          this.autoSkills.set(skillName, skillDef);
        } catch (error) {
          console.warn(`[AcpSkillManager] Failed to load builtin skill ${skillName}:`, error);
        }
      }

      console.log(`[AcpSkillManager] Discovered ${this.autoSkills.size} builtin skills`);
    } catch (error) {
      console.error(`[AcpSkillManager] Failed to discover builtin skills:`, error);
    }

    this.autoInitialized = true;
  }

  /**
   * 从 ExtensionRegistry 加载扩展贡献的 skills
   * Load extension-contributed skills from ExtensionRegistry
   *
   * 扩展 skills 通过 aion-extension.json 的 contributes.skills 声明，
   * 由 SkillResolver 解析后缓存在 ExtensionRegistry 中。
   * 这里将它们合并到 AcpSkillManager 中，使 agent 能够按需加载。
   */
  private async discoverExtensionSkills(enabledSkills?: string[]): Promise<void> {
    if (this.extensionInitialized) return;

    try {
      const registry = ExtensionRegistry.getInstance();
      const extSkills = registry.getSkills();

      if (extSkills.length === 0) {
        this.extensionInitialized = true;
        return;
      }

      for (const extSkill of extSkills) {
        // 如果指定了 enabledSkills，只加载被启用的扩展 skills
        // If enabledSkills is specified, only load enabled extension skills
        if (enabledSkills && enabledSkills.length > 0 && !enabledSkills.includes(extSkill.name)) {
          continue;
        }

        // 避免与内置/可选 skills 冲突 / Avoid conflicts with builtin/optional skills
        if (this.autoSkills.has(extSkill.name) || this.skills.has(extSkill.name)) {
          console.warn(`[AcpSkillManager] Extension skill "${extSkill.name}" conflicts with existing skill, skipping`);
          continue;
        }

        const skillDef: SkillDefinition = {
          name: extSkill.name,
          description: extSkill.description,
          location: extSkill.location,
        };

        this.extensionSkills.set(extSkill.name, skillDef);
      }

      if (this.extensionSkills.size > 0) {
        console.log(`[AcpSkillManager] Loaded ${this.extensionSkills.size} extension skills`);
      }
    } catch (error) {
      console.warn('[AcpSkillManager] Failed to load extension skills:', error);
    }

    this.extensionInitialized = true;
  }

  /**
   * 初始化：发现并加载所有 skills 的索引（不加载 body）
   * Initialize: discover and load index of all skills (without body)
   */
  async discoverSkills(enabledSkills?: string[]): Promise<void> {
    // 始终先加载内置 skills / Always load builtin skills first
    await this.discoverAutoSkills();

    // 加载扩展贡献的 skills / Load extension-contributed skills
    await this.discoverExtensionSkills(enabledSkills);

    if (this.initialized) return;

    // 未指定 enabledSkills 时不加载任何可选 skills（非 preset agent 场景）
    // Skip all optional skills when enabledSkills is not specified (non-preset agent)
    if (!enabledSkills || enabledSkills.length === 0) {
      this.initialized = true;
      return;
    }

    // Scan both builtin-skills/ (bundled, non-_builtin) and skills/ (user custom)
    const dirsToScan = [getBuiltinSkillsCopyDir(), this.skillsDir];

    for (const dir of dirsToScan) {
      if (!existsSync(dir)) continue;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

          const skillName = entry.name;

          // Skip _builtin directory (handled by discoverAutoSkills)
          if (skillName === '_builtin') continue;

          // Only load enabled skills
          if (!enabledSkills.includes(skillName)) continue;

          // Skip if already discovered (builtin-skills/ takes precedence)
          if (this.skills.has(skillName)) continue;

          const skillFile = path.join(dir, skillName, 'SKILL.md');
          if (!existsSync(skillFile)) continue;

          try {
            const content = await fs.readFile(skillFile, 'utf-8');
            const { name, description } = parseFrontmatter(content);

            this.skills.set(skillName, {
              name: name || skillName,
              description: description || `Skill: ${skillName}`,
              location: skillFile,
            });
          } catch (error) {
            console.warn(`[AcpSkillManager] Failed to load skill ${skillName}:`, error);
          }
        }
      } catch (error) {
        console.error(`[AcpSkillManager] Failed to discover skills in ${dir}:`, error);
      }
    }

    console.log(`[AcpSkillManager] Discovered ${this.skills.size} optional skills`);

    this.initialized = true;
  }

  /**
   * 获取所有 skills 的索引（轻量级）
   * 包含内置 skills + 可选 skills + 扩展 skills + Droid SDK skills
   * Get index of all skills (lightweight)
   * Includes builtin skills + optional skills + extension skills + Droid SDK skills
   *
   * Droid SDK 贡献的 subagent 类 skill 会在 description 前拼 `[subagent] `，
   * 让前端 / 会话 AI 一眼看出它是 subagent / custom droid（P0-4）。
   */
  getSkillsIndex(): SkillIndex[] {
    // Priority: optional (user-selected for this assistant) > builtin (auto-injected) > extension > sdk
    // User-selected skills come first because they represent the most specific intent for this assistant.
    const allSkills: SkillIndex[] = [];
    const seen = new Set<string>();

    const pushUnique = (entry: SkillIndex) => {
      if (seen.has(entry.name)) return;
      seen.add(entry.name);
      allSkills.push(entry);
    };

    // 可选 skills 优先（为此助手显式配置，最高优先级）
    // Optional skills first (explicitly configured for this assistant — highest priority)
    for (const skill of this.skills.values()) {
      pushUnique({
        name: skill.name,
        description: skill.description,
      });
    }

    // 然后是内置 skills / Then builtin skills
    for (const skill of this.autoSkills.values()) {
      pushUnique({
        name: skill.name,
        description: skill.description,
      });
    }

    // 扩展 skills / Then extension skills
    for (const skill of this.extensionSkills.values()) {
      pushUnique({
        name: skill.name,
        description: skill.description,
      });
    }

    // 最后是 Droid SDK skills / Finally, SDK skills (Droid backend only)
    for (const skill of this.sdkSkills.values()) {
      const description = skill.kind === 'subagent' ? `[subagent] ${skill.description}` : skill.description;
      pushUnique({
        name: skill.name,
        description,
      });
    }

    return allSkills;
  }

  /**
   * 获取内置 skills 的索引
   * Get index of builtin skills only
   */
  getBuiltinSkillsIndex(): SkillIndex[] {
    return Array.from(this.autoSkills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
  }

  /**
   * 检查是否有任何 skills（内置、可选、扩展或 Droid SDK 贡献）
   * Check if there are any skills (builtin / optional / extension / Droid SDK)
   */
  hasAnySkills(): boolean {
    return this.autoSkills.size > 0 || this.skills.size > 0 || this.extensionSkills.size > 0 || this.sdkSkills.size > 0;
  }

  /**
   * 按名称获取单个 skill 的完整内容（按需加载）
   * 优先级：可选（用户配置）> 内置 > 扩展
   * Get full content of a skill by name (on-demand loading)
   * Priority: optional (user-configured) > builtin > extension
   */
  async getSkill(name: string): Promise<SkillDefinition | null> {
    // 优先查找可选 skills（用户为此助手显式配置）
    // Check optional skills first (explicitly configured for this assistant)
    let skill = this.skills.get(name);
    // 再查找内置 skills / Then search builtin skills
    if (!skill) {
      skill = this.autoSkills.get(name);
    }
    // 最后查找扩展 skills / Then search extension skills
    if (!skill) {
      skill = this.extensionSkills.get(name);
    }
    if (!skill) return null;

    // 如果 body 还没加载，现在加载
    if (skill.body === undefined) {
      try {
        const content = await fs.readFile(skill.location, 'utf-8');
        skill.body = extractBody(content);
      } catch (error) {
        console.warn(`[AcpSkillManager] Failed to load skill body for ${name}:`, error);
        skill.body = '';
      }
    }

    return skill;
  }

  /**
   * 获取多个 skills 的完整内容
   * Get full content of multiple skills
   */
  async getSkills(names: string[]): Promise<SkillDefinition[]> {
    const results: SkillDefinition[] = [];
    for (const name of names) {
      const skill = await this.getSkill(name);
      if (skill) {
        results.push(skill);
      }
    }
    return results;
  }

  /**
   * 检查 skill 是否存在（包括内置、可选、扩展和 SDK 贡献）
   * Check if a skill exists (including builtin / optional / extension / Droid SDK)
   */
  hasSkill(name: string): boolean {
    return (
      this.autoSkills.has(name) || this.skills.has(name) || this.extensionSkills.has(name) || this.sdkSkills.has(name)
    );
  }

  /**
   * Droid SDK 路径专用：用 `session.listSkills()` 返回值替换 SDK skills 缓存。
   * Called by DroidSdkAgent after `session.listSkills()` returns successfully.
   * Existing SDK skills are replaced wholesale — callers should pass the full list each time.
   *
   * @param skills 归一化后的 Droid SDK skills
   */
  setSdkSkills(skills: SdkSkill[]): void {
    this.sdkSkills.clear();
    for (const skill of skills) {
      if (!skill?.name) continue;
      this.sdkSkills.set(skill.name, { ...skill });
    }
  }

  /**
   * 清空 SDK 贡献的 skills（例如 Droid session 关闭时）。
   * Clear SDK-sourced skills (e.g. when the Droid session closes).
   */
  clearSdkSkills(): void {
    this.sdkSkills.clear();
  }

  /**
   * 读取当前缓存的 SDK skills（拷贝一份，避免外部改写内部状态）。
   * Snapshot the currently cached SDK skills.
   */
  getSdkSkills(): SdkSkill[] {
    return Array.from(this.sdkSkills.values()).map((skill) => ({ ...skill }));
  }

  /**
   * 清除缓存的 body 内容（用于刷新）
   * Clear cached body content (for refresh)
   */
  clearCache(): void {
    for (const skill of this.autoSkills.values()) {
      skill.body = undefined;
    }
    for (const skill of this.skills.values()) {
      skill.body = undefined;
    }
    for (const skill of this.extensionSkills.values()) {
      skill.body = undefined;
    }
  }
}

/**
 * 构建 skills 索引文本（用于首条消息注入）
 * Build skills index text (for first message injection)
 */
export function buildSkillsIndexText(skills: SkillIndex[]): string {
  if (skills.length === 0) return '';

  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);

  return `[Available Skills]
The following skills are available. When you need detailed instructions for a specific skill,
you can request it by outputting: [LOAD_SKILL: skill-name]

${lines.join('\n')}`;
}

/**
 * 检测消息中是否请求加载 skill
 * Detect if message requests loading a skill
 */
export function detectSkillLoadRequest(content: string): string[] {
  const matches = content.matchAll(/\[LOAD_SKILL:\s*([^\]]+)\]/gi);
  const requested: string[] = [];
  for (const match of matches) {
    requested.push(match[1].trim());
  }
  return requested;
}

/**
 * 构建 skill 内容文本（用于注入）
 * Build skill content text (for injection)
 */
export function buildSkillContentText(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  return skills.map((s) => `[Skill: ${s.name}]\n${s.body}`).join('\n\n');
}
