/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { AionModal } from '@/renderer/components/base';
import { Button } from '@arco-design/web-react';
import { Caution } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * SkipPermissionsConfirmModal — "真 YOLO" (`skipPermissionsUnsafe`) 二次确认弹窗。
 *
 * SKILL `droid-sdk-integration` P0-3 硬约束：
 * - YOLO 模式 默认 **不** 开启 `skipPermissionsUnsafe`；必须 UI 弹窗 + 用户显式点
 *   "我确认风险，启用真 YOLO" 才允许后端把 `skipPermissionsUnsafe: true` 下发。
 * - 取消按钮等于回退到现有 AutonomyLevel=High 的"非真 YOLO"（策略层仍会自动批准
 *   权限请求，但 CLI 仍保留发送 permissionHandler 的能力）。
 *
 * Visual rationale: the left-side IconPark `Caution` icon reinforces that this
 * is a dangerous opt-in; content text must stay explicit about the risks.
 */
export interface SkipPermissionsConfirmModalProps {
  /** Whether the modal is visible / 弹窗是否可见 */
  visible: boolean;
  /** Whether the confirm action is in-flight / 是否正在执行确认请求 */
  loading?: boolean;
  /**
   * Called when the user clicks "confirm" (i.e. explicitly opts in to real YOLO).
   * The renderer MUST then invoke `ipcBridge.acpConversation.setSkipPermissionsUnsafe(..., true)`.
   */
  onConfirm: () => void;
  /** Called when the user cancels / 关闭弹窗或点击"取消"时触发 */
  onCancel: () => void;
}

const SkipPermissionsConfirmModal: React.FC<SkipPermissionsConfirmModalProps> = ({
  visible,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();

  return (
    <AionModal
      visible={visible}
      onCancel={onCancel}
      size='small'
      header={{
        title: (
          <div className='flex items-center gap-8px'>
            <span className='inline-flex w-20px h-20px items-center justify-center text-warning'>
              <Caution theme='outline' size={20} />
            </span>
            <span>{t('agentMode.yoloConfirmTitle', { defaultValue: '启用 真 YOLO（跳过所有权限提示）？' })}</span>
          </div>
        ),
        showClose: true,
      }}
      footer={
        <div className='flex justify-end gap-10px mt-10px'>
          <Button onClick={onCancel} disabled={loading} className='px-20px min-w-80px' style={{ borderRadius: 8 }}>
            {t('agentMode.yoloConfirmCancelButton', { defaultValue: '取消' })}
          </Button>
          <Button
            type='primary'
            status='warning'
            loading={loading}
            onClick={onConfirm}
            className='px-20px min-w-80px'
            style={{ borderRadius: 8 }}
          >
            {t('agentMode.yoloConfirmConfirmButton', { defaultValue: '我确认风险，启用真 YOLO' })}
          </Button>
        </div>
      }
      contentStyle={{ padding: '20px' }}
    >
      <div className='flex flex-col gap-12px text-14px leading-relaxed text-t-primary'>
        <p className='m-0'>
          {t('agentMode.yoloConfirmBody', {
            defaultValue:
              '开启"真 YOLO"后，智能体工厂会向 Droid CLI 下发 skipPermissionsUnsafe，Droid 将跳过所有权限提示，直接执行包括删除文件、推送代码、运行不可逆命令在内的一切操作。',
          })}
        </p>
        <p className='m-0 text-warning'>
          {t('agentMode.yoloConfirmWarning', {
            defaultValue: '此设置仅对当前会话生效，切换到其他模式时会自动关闭。请确认你真的要在可控环境下使用。',
          })}
        </p>
      </div>
    </AionModal>
  );
};

export default SkipPermissionsConfirmModal;
