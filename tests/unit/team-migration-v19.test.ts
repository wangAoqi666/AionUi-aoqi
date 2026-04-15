// tests/unit/team-migration-v19.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@process/services/database/schema';
import { runMigrations, ALL_MIGRATIONS } from '@process/services/database/migrations';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';

let nativeModuleAvailable = true;
try {
  const d = new BetterSqlite3Driver(':memory:');
  d.close();
} catch (e) {
  if (e instanceof Error && e.message.includes('NODE_MODULE_VERSION')) {
    nativeModuleAvailable = false;
  }
}

const describeOrSkip = nativeModuleAvailable ? describe : describe.skip;

describeOrSkip('migration v19: teams table', () => {
  let driver: BetterSqlite3Driver;

  beforeEach(() => {
    driver = new BetterSqlite3Driver(':memory:');
    initSchema(driver);
    runMigrations(driver, 0, 18); // bring to v18
  });

  afterEach(() => {
    driver.close();
  });

  it('creates teams table with correct columns', () => {
    runMigrations(driver, 18, 19);
    const cols = (driver.pragma('table_info(teams)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('name');
    expect(cols).toContain('workspace');
    expect(cols).toContain('workspace_mode');
    expect(cols).toContain('agents');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  it('rollback drops teams table', () => {
    runMigrations(driver, 18, 19);
    // rollback by calling migration down directly
    ALL_MIGRATIONS.find((m) => m.version === 19)!.down(driver);
    const tables = driver.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'").all() as Array<{
      name: string;
    }>;
    expect(tables).toHaveLength(0);
  });
});

describeOrSkip('migration v20: lead_agent_id, mailbox, team_tasks', () => {
  let driver: BetterSqlite3Driver;

  beforeEach(() => {
    driver = new BetterSqlite3Driver(':memory:');
    initSchema(driver);
    runMigrations(driver, 0, 19); // bring to v19
  });

  afterEach(() => {
    driver.close();
  });

  it('adds lead_agent_id column to teams table', () => {
    runMigrations(driver, 19, 20);
    const cols = (driver.pragma('table_info(teams)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('lead_agent_id');
  });

  it('creates mailbox table with correct columns', () => {
    runMigrations(driver, 19, 20);
    const cols = (driver.pragma('table_info(mailbox)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('team_id');
    expect(cols).toContain('to_agent_id');
    expect(cols).toContain('from_agent_id');
    expect(cols).toContain('type');
    expect(cols).toContain('content');
    expect(cols).toContain('summary');
    expect(cols).toContain('read');
    expect(cols).toContain('created_at');
  });

  it('creates team_tasks table with correct columns', () => {
    runMigrations(driver, 19, 20);
    const cols = (driver.pragma('table_info(team_tasks)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('team_id');
    expect(cols).toContain('subject');
    expect(cols).toContain('description');
    expect(cols).toContain('status');
    expect(cols).toContain('owner');
    expect(cols).toContain('blocked_by');
    expect(cols).toContain('blocks');
    expect(cols).toContain('metadata');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  it('rollback drops mailbox and team_tasks tables', () => {
    runMigrations(driver, 19, 20);
    ALL_MIGRATIONS.find((m) => m.version === 20)!.down(driver);
    const mailboxTables = driver
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mailbox'")
      .all() as Array<{ name: string }>;
    const taskTables = driver
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_tasks'")
      .all() as Array<{ name: string }>;
    expect(mailboxTables).toHaveLength(0);
    expect(taskTables).toHaveLength(0);
  });
});

describeOrSkip('migration v23: plugin-scoped channel data', () => {
  let driver: BetterSqlite3Driver;

  beforeEach(() => {
    driver = new BetterSqlite3Driver(':memory:');
    initSchema(driver);
    runMigrations(driver, 0, 22);
  });

  afterEach(() => {
    driver.close();
  });

  it('adds plugin instance columns and backfills legacy channel rows', () => {
    const now = Date.now();

    driver
      .prepare(
        `INSERT INTO users (id, username, email, password_hash, avatar_path, jwt_secret, created_at, updated_at, last_login)
         VALUES (?, ?, NULL, ?, NULL, NULL, ?, ?, NULL)`
      )
      .run('user-1', 'user-1', 'hash', now, now);

    driver
      .prepare(
        `INSERT INTO conversations (id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
      )
      .run('conv-1', 'user-1', 'WeChat chat', 'acp', '{}', 'finished', 'weixin', 'chat-1', now, now);

    driver
      .prepare(
        `INSERT INTO assistant_users (id, platform_user_id, platform_type, display_name, authorized_at, last_active, session_id)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      )
      .run('assistant-user-1', 'wx-user-1', 'weixin', 'Tester', now, now);

    driver
      .prepare(
        `INSERT INTO assistant_sessions (id, user_id, agent_type, conversation_id, workspace, chat_id, created_at, last_activity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('assistant-session-1', 'assistant-user-1', 'acp', 'conv-1', '/tmp/workspace', 'chat-1', now, now);

    driver
      .prepare(
        `INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, display_name, requested_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('123456', 'wx-user-1', 'weixin', 'Tester', now, now + 60_000, 'pending');

    runMigrations(driver, 22, 23);

    const assistantUserColumns = (driver.pragma('table_info(assistant_users)') as Array<{ name: string }>).map(
      (column) => column.name
    );
    const assistantSessionColumns = (driver.pragma('table_info(assistant_sessions)') as Array<{ name: string }>).map(
      (column) => column.name
    );
    const pairingColumns = (driver.pragma('table_info(assistant_pairing_codes)') as Array<{ name: string }>).map(
      (column) => column.name
    );
    const conversationColumns = (driver.pragma('table_info(conversations)') as Array<{ name: string }>).map(
      (column) => column.name
    );

    expect(assistantUserColumns).toContain('plugin_id');
    expect(assistantSessionColumns).toContain('plugin_id');
    expect(pairingColumns).toContain('plugin_id');
    expect(conversationColumns).toContain('channel_plugin_id');

    const assistantUser = driver
      .prepare('SELECT plugin_id FROM assistant_users WHERE id = ?')
      .get('assistant-user-1') as {
      plugin_id: string;
    };
    const assistantSession = driver
      .prepare('SELECT plugin_id FROM assistant_sessions WHERE id = ?')
      .get('assistant-session-1') as {
      plugin_id: string;
    };
    const pairingRequest = driver
      .prepare('SELECT plugin_id FROM assistant_pairing_codes WHERE code = ?')
      .get('123456') as {
      plugin_id: string;
    };
    const conversation = driver.prepare('SELECT channel_plugin_id FROM conversations WHERE id = ?').get('conv-1') as {
      channel_plugin_id: string;
    };

    expect(assistantUser.plugin_id).toBe('weixin_default');
    expect(assistantSession.plugin_id).toBe('weixin_default');
    expect(pairingRequest.plugin_id).toBe('weixin_default');
    expect(conversation.channel_plugin_id).toBe('weixin_default');
  });
});
