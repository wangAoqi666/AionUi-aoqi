/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ProjectFileType } from '@/common/adapter/ipcBridge';
import { Button, Drawer, Input, Menu, Message, Tooltip } from '@arco-design/web-react';
import { FileText } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ProjectConfigMode = ProjectFileType;

const FILE_LABELS: Record<ProjectConfigMode, { key: string; defaultValue: string }> = {
  rules: { key: 'settings.projectRules', defaultValue: 'Project Rules' },
  memories: { key: 'settings.projectMemory', defaultValue: 'Project Memory' },
  'agents-md': { key: 'settings.projectAgentsMd', defaultValue: 'AGENTS.md' },
};

const ProjectConfigButton: React.FC<{ workspace: string }> = ({ workspace }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ProjectConfigMode>('rules');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const loadFile = useCallback(
    async (fileType: ProjectConfigMode) => {
      const result = await ipcBridge.fs.readProjectFile.invoke({ workspace, fileType });
      setContent(typeof result === 'string' ? result : '');
    },
    [workspace],
  );

  useEffect(() => {
    if (open) {
      void loadFile(mode);
    }
  }, [open, mode, loadFile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await ipcBridge.fs.writeProjectFile.invoke({ workspace, fileType: mode, content });
      Message.success(t('common.saved', { defaultValue: 'Saved' }));
    } catch {
      Message.error(t('common.saveFailed', { defaultValue: 'Save failed' }));
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = () => {
    void ipcBridge.fs.ensureProjectFiles.invoke({ workspace });
    setOpen(true);
  };

  return (
    <>
      <Tooltip content={t('settings.projectConfig', { defaultValue: 'Project Config' })}>
        <Button
          size='mini'
          type='text'
          icon={<FileText size={14} />}
          onClick={handleOpen}
        />
      </Tooltip>
      <Drawer
        title={t('settings.projectConfig', { defaultValue: 'Project Config' })}
        visible={open}
        width={520}
        onCancel={() => setOpen(false)}
        footer={
          <Button type='primary' loading={saving} onClick={handleSave}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        }
      >
        <Menu
          mode='horizontal'
          selectedKeys={[mode]}
          onClickMenuItem={(key) => setMode(key as ProjectConfigMode)}
          style={{ marginBottom: 12 }}
        >
          {(Object.keys(FILE_LABELS) as ProjectConfigMode[]).map((key) => (
            <Menu.Item key={key}>{t(FILE_LABELS[key].key, { defaultValue: FILE_LABELS[key].defaultValue })}</Menu.Item>
          ))}
        </Menu>
        <Input.TextArea
          value={content}
          onChange={setContent}
          autoSize={{ minRows: 20 }}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
      </Drawer>
    </>
  );
};

export default ProjectConfigButton;
