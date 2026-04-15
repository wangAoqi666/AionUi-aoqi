/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AskUserConfirmationQuestion } from '@/common/chat/chatLib';
import { DroidIdleReclaimer } from './DroidIdleReclaimer';

export type DroidAskUserAnswerPayload = {
  cancelled?: boolean;
  answers: Array<{
    index: number;
    question: string;
    answer: string;
  }>;
};

export type DroidAskUserParseResult =
  | {
      ok: true;
      payload: DroidAskUserAnswerPayload;
    }
  | {
      ok: false;
      message: string;
    };

export class DroidTextAskBridge {
  private readonly reclaimer = new DroidIdleReclaimer();

  constructor(private askReplyTtlMs: number) {}

  updateSettings(askReplyTtlMs: number): void {
    this.askReplyTtlMs = askReplyTtlMs;
  }

  scheduleTimeout(callId: string, onTimeout: () => void | Promise<void>): void {
    this.reclaimer.schedule(`ask:${callId}`, this.askReplyTtlMs, onTimeout);
  }

  clearTimeout(callId: string): void {
    this.reclaimer.cancel(`ask:${callId}`);
  }

  formatPrompt(questions: AskUserConfirmationQuestion[]): string {
    const lines = ['I need a quick reply before I can continue:'];

    for (const question of questions) {
      lines.push(`${question.index + 1}. ${question.question}`);
      if (question.topic) {
        lines.push(`   Topic: ${question.topic}`);
      }
      if (question.options.length > 0) {
        lines.push('   Options:');
        question.options.forEach((option, optionIndex) => {
          lines.push(`   ${optionIndex + 1}) ${option}`);
        });
      }
    }

    if (questions.length === 1) {
      lines.push('Reply with an option number, the option text, or your own short answer.');
    } else {
      lines.push('Reply with one line per question, for example:');
      lines.push('1. first answer');
      lines.push('2. second answer');
    }

    return lines.join('\n');
  }

  buildRetryPrompt(questions: AskUserConfirmationQuestion[]): string {
    return `${this.formatPrompt(questions)}\n\nI could not match your reply. Please answer using the expected numbered format.`;
  }

  static parseReply(questions: AskUserConfirmationQuestion[], rawText: string): DroidAskUserParseResult {
    const text = rawText.trim();
    if (!text) {
      return {
        ok: false,
        message: 'Empty reply received. Please answer the pending Droid question first.',
      };
    }

    if (questions.length === 1) {
      return this.parseSingleQuestionReply(questions[0], text);
    }

    const parsedLines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.match(/^(\d+)[.)、:\-\s]+(.+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match));

    if (parsedLines.length < questions.length) {
      return {
        ok: false,
        message: 'Please reply with one numbered line per pending question.',
      };
    }

    const answerMap = new Map<number, string>();
    for (const match of parsedLines) {
      const index = Number(match[1]) - 1;
      const answer = match[2]?.trim();
      if (!Number.isInteger(index) || !answer) {
        continue;
      }
      answerMap.set(index, answer);
    }

    const answers = questions.map((question) => {
      const rawAnswer = answerMap.get(question.index);
      if (!rawAnswer) {
        return null;
      }

      return {
        index: question.index,
        question: question.question,
        answer: this.normalizeAnswer(question, rawAnswer),
      };
    });

    if (answers.some((answer) => answer === null)) {
      return {
        ok: false,
        message: 'Some answers are missing. Please reply with one numbered line for each pending question.',
      };
    }

    return {
      ok: true,
      payload: {
        answers: answers.filter((answer): answer is NonNullable<typeof answer> => Boolean(answer)),
      },
    };
  }

  private static parseSingleQuestionReply(
    question: AskUserConfirmationQuestion,
    text: string
  ): DroidAskUserParseResult {
    const numberedAnswer = text.match(/^(\d+)[.)、:\-\s]+(.+)$/);
    const normalizedText = numberedAnswer?.[2]?.trim() || text;
    return {
      ok: true,
      payload: {
        answers: [
          {
            index: question.index,
            question: question.question,
            answer: this.normalizeAnswer(question, normalizedText),
          },
        ],
      },
    };
  }

  private static normalizeAnswer(question: AskUserConfirmationQuestion, rawAnswer: string): string {
    const numericSelection = rawAnswer.match(/^(\d+)$/);
    if (numericSelection) {
      const optionIndex = Number(numericSelection[1]) - 1;
      if (optionIndex >= 0 && optionIndex < question.options.length) {
        return question.options[optionIndex];
      }
    }

    const matchedOption = question.options.find((option) => option.toLowerCase() === rawAnswer.toLowerCase());
    return matchedOption ?? rawAnswer;
  }
}
