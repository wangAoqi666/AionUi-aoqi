import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ExtWecomBotChannelPlugin = require(
  path.resolve(currentDir, '../../../../examples/ext-wecom-bot/channels/ext-wecom-bot-channel.js')
);

describe('ext-wecom-bot channel plugin', () => {
  it('attaches the configured plugin id to inbound unified messages', () => {
    const plugin = new ExtWecomBotChannelPlugin({
      id: 'ext-wecom-bot_workspace-a',
    });

    const message = plugin.toUnifiedIncomingMessage({
      msgid: 'msg-1',
      msgtype: 'text',
      text: { content: 'hello' },
      from: {
        userid: 'user-1',
        name: 'Tester',
      },
    });

    expect(message.pluginId).toBe('ext-wecom-bot_workspace-a');
    expect(message.platform).toBe('ext-wecom-bot');
    expect(message.chatId).toBe('dm:user-1');
  });
});
