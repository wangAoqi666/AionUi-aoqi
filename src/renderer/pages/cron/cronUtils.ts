/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { TFunction } from 'i18next';

const WEEKDAY_LABEL_KEY_BY_VALUE: Record<string, string> = {
  MON: 'monday',
  TUE: 'tuesday',
  WED: 'wednesday',
  THU: 'thursday',
  FRI: 'friday',
  SAT: 'saturday',
  SUN: 'sunday',
};

export type CronFrequencyType = 'manual' | 'everyMinute' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'advanced';

export type CronAdvancedMode = 'minuteInterval' | 'hourInterval' | 'daily' | 'weekly' | 'cronExpr';

export type CronScheduleDraft = {
  frequency: CronFrequencyType;
  time: string;
  weekday: string;
  advancedMode: CronAdvancedMode;
  minuteInterval: number;
  hourInterval: number;
  hourMinute: string;
  customExpr: string;
};

type CronExpressionSchedule = Extract<ICronJob['schedule'], { kind: 'cron' }>;

const DEFAULT_SCHEDULE_DRAFT: CronScheduleDraft = {
  frequency: 'manual',
  time: '09:00',
  weekday: 'MON',
  advancedMode: 'minuteInterval',
  minuteInterval: 5,
  hourInterval: 2,
  hourMinute: '00',
  customExpr: '',
};

function isNumericSegment(value: string): boolean {
  return /^\d+$/.test(value);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}

function formatMinute(minute: number | string): string {
  return String(minute).padStart(2, '0');
}

function getParsedTime(time: string): { hour: number; minute: number } {
  const [hour = '9', minute = '0'] = time.split(':');
  return {
    hour: clampInteger(Number(hour), 0, 23),
    minute: clampInteger(Number(minute), 0, 59),
  };
}

export function createDefaultCronScheduleDraft(): CronScheduleDraft {
  return { ...DEFAULT_SCHEDULE_DRAFT };
}

export function parseCronSchedule(schedule: ICronJob['schedule']): CronScheduleDraft {
  if (schedule.kind === 'every') {
    const everyMinutes = Math.max(1, Math.round(schedule.everyMs / 60000));
    if (everyMinutes === 1) {
      return {
        ...createDefaultCronScheduleDraft(),
        frequency: 'everyMinute',
      };
    }

    if (everyMinutes === 60) {
      return {
        ...createDefaultCronScheduleDraft(),
        frequency: 'hourly',
      };
    }

    if (everyMinutes > 0 && everyMinutes < 60) {
      return {
        ...createDefaultCronScheduleDraft(),
        frequency: 'advanced',
        advancedMode: 'minuteInterval',
        minuteInterval: everyMinutes,
      };
    }

    const hourInterval = Math.max(1, Math.round(everyMinutes / 60));
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'advanced',
      advancedMode: 'hourInterval',
      hourInterval,
      hourMinute: '00',
    };
  }

  if (schedule.kind !== 'cron') {
    return createDefaultCronScheduleDraft();
  }

  const expr = schedule.expr?.trim();
  if (!expr) {
    return createDefaultCronScheduleDraft();
  }

  const parts = expr.split(/\s+/);
  if (parts.length < 5) {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'advanced',
      advancedMode: 'cronExpr',
      customExpr: expr,
    };
  }

  const [min, hour, dayOfMonth, month, rawDayOfWeek] = parts;
  const dayOfWeek = rawDayOfWeek.toUpperCase();

  if (min === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'everyMinute',
    };
  }

  if (min === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'hourly',
    };
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isNumericSegment(min) && hour === '*') {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'advanced',
      advancedMode: 'hourInterval',
      hourInterval: 1,
      hourMinute: formatMinute(min),
    };
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && /^\*\/\d+$/.test(min) && hour === '*') {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'advanced',
      advancedMode: 'minuteInterval',
      minuteInterval: clampInteger(Number(min.slice(2)), 1, 59),
    };
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isNumericSegment(min) && /^\*\/\d+$/.test(hour)) {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'advanced',
      advancedMode: 'hourInterval',
      hourInterval: clampInteger(Number(hour.slice(2)), 1, 23),
      hourMinute: formatMinute(min),
    };
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isNumericSegment(hour) && isNumericSegment(min)) {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'daily',
      time: formatTime(hour, min),
    };
  }

  if (
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === 'MON-FRI' &&
    isNumericSegment(hour) &&
    isNumericSegment(min)
  ) {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'weekdays',
      time: formatTime(hour, min),
    };
  }

  const weekdayKey = WEEKDAY_LABEL_KEY_BY_VALUE[dayOfWeek];
  if (dayOfMonth === '*' && month === '*' && weekdayKey && isNumericSegment(hour) && isNumericSegment(min)) {
    return {
      ...createDefaultCronScheduleDraft(),
      frequency: 'weekly',
      time: formatTime(hour, min),
      weekday: dayOfWeek,
    };
  }

  return {
    ...createDefaultCronScheduleDraft(),
    frequency: 'advanced',
    advancedMode: 'cronExpr',
    customExpr: expr,
  };
}

export function buildCronScheduleFromDraft(draft: CronScheduleDraft, t: TFunction): CronExpressionSchedule {
  const { hour, minute } = getParsedTime(draft.time);
  const minuteOfHour = clampInteger(Number(draft.hourMinute), 0, 59);

  switch (draft.frequency) {
    case 'manual':
      return { kind: 'cron', expr: '', description: t('cron.page.scheduleDesc.manual') };
    case 'everyMinute':
      return { kind: 'cron', expr: '* * * * *', description: t('cron.page.scheduleDesc.everyMinute') };
    case 'hourly':
      return { kind: 'cron', expr: '0 * * * *', description: t('cron.page.scheduleDesc.hourly') };
    case 'daily':
      return {
        kind: 'cron',
        expr: `${minute} ${hour} * * *`,
        description: t('cron.page.scheduleDesc.dailyAt', { time: draft.time }),
      };
    case 'weekdays':
      return {
        kind: 'cron',
        expr: `${minute} ${hour} * * MON-FRI`,
        description: t('cron.page.scheduleDesc.weekdaysAt', { time: draft.time }),
      };
    case 'weekly': {
      const weekdayKey = WEEKDAY_LABEL_KEY_BY_VALUE[draft.weekday] ?? WEEKDAY_LABEL_KEY_BY_VALUE.MON;
      return {
        kind: 'cron',
        expr: `${minute} ${hour} * * ${draft.weekday}`,
        description: t('cron.page.scheduleDesc.weeklyAt', {
          day: t(`cron.page.weekday.${weekdayKey}`),
          time: draft.time,
        }),
      };
    }
    case 'advanced':
      switch (draft.advancedMode) {
        case 'minuteInterval': {
          const interval = clampInteger(draft.minuteInterval, 1, 59);
          return {
            kind: 'cron',
            expr: interval === 1 ? '* * * * *' : `*/${interval} * * * *`,
            description:
              interval === 1
                ? t('cron.page.scheduleDesc.everyMinute')
                : t('cron.page.scheduleDesc.everyMinutes', { count: interval }),
          };
        }
        case 'hourInterval': {
          const interval = clampInteger(draft.hourInterval, 1, 23);
          const minuteLabel = formatMinute(minuteOfHour);
          return {
            kind: 'cron',
            expr: interval === 1 ? `${minuteOfHour} * * * *` : `${minuteOfHour} */${interval} * * *`,
            description:
              interval === 1
                ? minuteOfHour === 0
                  ? t('cron.page.scheduleDesc.hourly')
                  : t('cron.page.scheduleDesc.hourlyAtMinute', { minute: minuteLabel })
                : t('cron.page.scheduleDesc.everyHoursAtMinute', { count: interval, minute: minuteLabel }),
          };
        }
        case 'daily':
          return {
            kind: 'cron',
            expr: `${minute} ${hour} * * *`,
            description: t('cron.page.scheduleDesc.dailyAt', { time: draft.time }),
          };
        case 'weekly': {
          const weekdayKey = WEEKDAY_LABEL_KEY_BY_VALUE[draft.weekday] ?? WEEKDAY_LABEL_KEY_BY_VALUE.MON;
          return {
            kind: 'cron',
            expr: `${minute} ${hour} * * ${draft.weekday}`,
            description: t('cron.page.scheduleDesc.weeklyAt', {
              day: t(`cron.page.weekday.${weekdayKey}`),
              time: draft.time,
            }),
          };
        }
        case 'cronExpr': {
          const expr = draft.customExpr.trim();
          return {
            kind: 'cron',
            expr,
            description: expr ? t('cron.page.scheduleDesc.customCron', { expr }) : t('cron.page.scheduleDesc.manual'),
          };
        }
      }
  }

  return { kind: 'cron', expr: '', description: t('cron.page.scheduleDesc.manual') };
}

function formatTime(hour: string, minute: string): string {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function formatCronExpr(expr: string, t: TFunction): string | null {
  if (!expr) return t('cron.page.scheduleDesc.manual');

  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const normalizedDayOfWeek = dayOfWeek.toUpperCase();
  const time = formatTime(hour, minute);

  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && normalizedDayOfWeek === '*') {
    return t('cron.page.scheduleDesc.everyMinute');
  }

  if (/^\*\/\d+$/.test(minute) && hour === '*' && dayOfMonth === '*' && month === '*' && normalizedDayOfWeek === '*') {
    return t('cron.page.scheduleDesc.everyMinutes', { count: Number(minute.slice(2)) });
  }

  if (
    /^\*\/\d+$/.test(hour) &&
    isNumericSegment(minute) &&
    dayOfMonth === '*' &&
    month === '*' &&
    normalizedDayOfWeek === '*'
  ) {
    const interval = Number(hour.slice(2));
    const minuteLabel = formatMinute(minute);
    return interval === 1
      ? minuteLabel === '00'
        ? t('cron.page.scheduleDesc.hourly')
        : t('cron.page.scheduleDesc.hourlyAtMinute', { minute: minuteLabel })
      : t('cron.page.scheduleDesc.everyHoursAtMinute', { count: interval, minute: minuteLabel });
  }

  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return t('cron.page.scheduleDesc.hourly');
  }

  if (hour === '*' && isNumericSegment(minute) && dayOfMonth === '*' && month === '*' && normalizedDayOfWeek === '*') {
    return minute === '0'
      ? t('cron.page.scheduleDesc.hourly')
      : t('cron.page.scheduleDesc.hourlyAtMinute', { minute: formatMinute(minute) });
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && hour !== '*' && minute !== '*') {
    return t('cron.page.scheduleDesc.dailyAt', { time });
  }

  if (dayOfMonth === '*' && month === '*' && normalizedDayOfWeek === 'MON-FRI') {
    return t('cron.page.scheduleDesc.weekdaysAt', { time });
  }

  const weekdayKey = WEEKDAY_LABEL_KEY_BY_VALUE[normalizedDayOfWeek];
  if (dayOfMonth === '*' && month === '*' && weekdayKey) {
    return t('cron.page.scheduleDesc.weeklyAt', {
      day: t(`cron.page.weekday.${weekdayKey}`),
      time,
    });
  }

  return null;
}

/**
 * Format schedule for display - use human-readable description
 */
export function formatSchedule(job: ICronJob, t: TFunction): string {
  if (job.schedule.kind === 'cron') {
    return formatCronExpr(job.schedule.expr, t) ?? job.schedule.description;
  }

  if (job.schedule.kind === 'every') {
    return buildCronScheduleFromDraft(parseCronSchedule(job.schedule), t).description;
  }

  return job.schedule.description;
}

/**
 * Format next run time for display
 */
export function formatNextRun(nextRunAtMs?: number): string {
  if (!nextRunAtMs) return '-';
  const date = new Date(nextRunAtMs);
  return date.toLocaleString();
}

/**
 * Get job status flags
 */
export function getJobStatusFlags(job: ICronJob): { hasError: boolean; isPaused: boolean } {
  return {
    hasError: job.state.lastStatus === 'error',
    isPaused: !job.enabled,
  };
}
