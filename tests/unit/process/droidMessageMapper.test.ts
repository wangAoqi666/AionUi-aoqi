import { describe, expect, it } from 'vitest';
import { DroidMessageMapper } from '@/process/agent/droid/messageMapper';

type DroidMessageInput = Parameters<DroidMessageMapper['mapMessage']>[0];

const createAssistantTextDelta = (text: string): DroidMessageInput =>
  ({
    type: 'assistant_text_delta',
    text,
  }) as DroidMessageInput;

const createToolUse = (): DroidMessageInput =>
  ({
    type: 'tool_use',
    toolUseId: 'tool-1',
    toolName: 'LS',
    toolInput: {
      directory_path: '/tmp/workspace',
    },
  }) as DroidMessageInput;

describe('DroidMessageMapper', () => {
  it('starts a fresh assistant text message after a tool call begins', () => {
    const mapper = new DroidMessageMapper('conversation-1');

    const firstText = mapper.mapMessage(createAssistantTextDelta('Step 1: Search the workspace.'));
    const toolUse = mapper.mapMessage(createToolUse());
    const secondText = mapper.mapMessage(createAssistantTextDelta('Step 2: Download the selected files.'));

    expect(firstText[0]).toMatchObject({
      type: 'content',
      data: 'Step 1: Search the workspace.',
    });
    expect(toolUse[0]).toMatchObject({
      type: 'acp_tool_call',
      msg_id: 'tool-1',
      data: {
        update: {
          toolCallId: 'tool-1',
          rawInput: {
            directory_path: '/tmp/workspace',
          },
        },
      },
    });
    expect(secondText[0]).toMatchObject({
      type: 'content',
      data: 'Step 2: Download the selected files.',
    });
    expect(firstText[0]?.msg_id).not.toBe(secondText[0]?.msg_id);
  });
});
