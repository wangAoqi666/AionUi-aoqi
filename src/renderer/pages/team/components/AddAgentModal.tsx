import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import AionModal from '@renderer/components/base/AionModal';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import { agentKey, getDefaultTeamAgent, AgentOptionLabel } from './agentSelectUtils';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (data: { agentName: string; agentKey: string }) => void;
};

const AddAgentModal: React.FC<Props> = ({ visible, onClose, onConfirm }) => {
  const { t } = useTranslation();
  const { cliAgents, presetAssistants } = useConversationAgents();
  const [agentName, setAgentName] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);

  const allAgents = useMemo(() => [...cliAgents, ...presetAssistants], [cliAgents, presetAssistants]);
  const defaultAgent = useMemo(() => getDefaultTeamAgent(allAgents), [allAgents]);

  useEffect(() => {
    if (!visible) return;
    setSelectedKey(defaultAgent ? agentKey(defaultAgent) : undefined);
  }, [defaultAgent, visible]);

  const handleClose = () => {
    setAgentName('');
    setSelectedKey(defaultAgent ? agentKey(defaultAgent) : undefined);
    onClose();
  };

  const handleConfirm = () => {
    if (!agentName.trim() || !selectedKey) return;
    onConfirm({ agentName: agentName.trim(), agentKey: selectedKey });
    handleClose();
  };

  const canConfirm = agentName.trim().length > 0 && selectedKey !== undefined;

  return (
    <AionModal
      visible={visible}
      onCancel={handleClose}
      header={t('team.addAgent.title', { defaultValue: 'Add Agent' })}
      footer={
        <div className='flex justify-end pt-4px'>
          <Button
            type='primary'
            disabled={!canConfirm}
            onClick={handleConfirm}
            className='px-20px min-w-80px'
            style={{ borderRadius: 8 }}
          >
            {t('team.addAgent.confirm', { defaultValue: 'Add' })}
          </Button>
        </div>
      }
      size='small'
    >
      <div className='flex flex-col gap-20px p-20px'>
        <div className='flex flex-col gap-6px'>
          <label className='text-sm text-[var(--color-text-2)] font-medium'>
            {t('team.addAgent.name', { defaultValue: 'Agent Name' })}
          </label>
          <Input
            placeholder={t('team.addAgent.namePlaceholder', { defaultValue: 'Enter agent name' })}
            value={agentName}
            onChange={setAgentName}
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <label className='text-sm text-[var(--color-text-2)] font-medium'>
            {t('team.addAgent.type', { defaultValue: 'Agent Type' })}
          </label>
          <div className='rounded-10px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-1)] px-12px py-10px'>
            {defaultAgent ? (
              <AgentOptionLabel agent={defaultAgent} />
            ) : (
              <span className='text-13px text-[var(--color-text-3)]'>
                {t('team.create.noSupportedAgents', { defaultValue: 'No supported agents installed' })}
              </span>
            )}
          </div>
        </div>
      </div>
    </AionModal>
  );
};

export default AddAgentModal;
