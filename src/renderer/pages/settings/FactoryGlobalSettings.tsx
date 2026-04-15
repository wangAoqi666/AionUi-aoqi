/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IFactoryGlobalPaths, IFactoryRuleFile } from '@/common/adapter/ipcBridge';
import { Button, Empty, Input, Menu, Message, Modal, Popover, Spin, Typography } from '@arco-design/web-react';
import { FileText, Info, Plus, Refresh, Write } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import SettingsPageWrapper from './components/SettingsPageWrapper';

type FactorySettingsMode = 'rules' | 'memory' | 'agents-md';

const resolveMode = (pathname: string): FactorySettingsMode => {
  if (pathname === '/settings/memory') {
    return 'memory';
  }

  if (pathname === '/settings/agents-md') {
    return 'agents-md';
  }

  return 'rules';
};

const joinPlatformPath = (basePath: string, fileName: string, platform: string): string => {
  const separator = platform === 'win32' ? '\\' : '/';
  const normalizedBase = basePath.replace(/[\\/]+$/, '');
  return `${normalizedBase}${separator}${fileName}`;
};

const normalizeRuleFileName = (value: string): string => {
  const sanitized = value.trim().replace(/[\\/]/g, '-');
  if (!sanitized) {
    return '';
  }

  return sanitized.toLowerCase().endsWith('.md') ? sanitized : `${sanitized}.md`;
};

const FactoryGlobalSettings: React.FC = () => {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const mode = useMemo(() => resolveMode(pathname), [pathname]);
  const isRulesMode = mode === 'rules';

  const [paths, setPaths] = useState<IFactoryGlobalPaths | null>(null);
  const [ruleFiles, setRuleFiles] = useState<IFactoryRuleFile[]>([]);
  const [selectedRulePath, setSelectedRulePath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createRuleVisible, setCreateRuleVisible] = useState(false);
  const [newRuleFileName, setNewRuleFileName] = useState('');
  const [messageApi, messageContext] = Message.useMessage();
  const tRef = useRef(t);
  const messageApiRef = useRef(messageApi);

  tRef.current = t;
  messageApiRef.current = messageApi;

  const pageMeta = useMemo(() => {
    switch (mode) {
      case 'memory':
        return {
          title: t('settings.memory', { defaultValue: 'Memory' }),
          description: t('settings.factoryGlobal.memoryDescription', {
            defaultValue: 'Edit the global user memory file used by Droid across projects.',
          }),
        };
      case 'agents-md':
        return {
          title: t('settings.agentsMd', { defaultValue: 'AGENTS.md' }),
          description: t('settings.factoryGlobal.agentsDescription', {
            defaultValue: 'Edit the global AGENTS.md instructions that apply across repositories.',
          }),
        };
      default:
        return {
          title: t('settings.rules', { defaultValue: 'Rules' }),
          description: t('settings.factoryGlobal.rulesDescription', {
            defaultValue: 'Manage global user rule files under the official ~/.factory/rules directory.',
          }),
        };
    }
  }, [mode, t]);

  const activeFilePath = useMemo(() => {
    if (!paths) {
      return null;
    }

    if (mode === 'memory') {
      return paths.memoriesFile;
    }

    if (mode === 'agents-md') {
      return paths.agentsFile;
    }

    return selectedRulePath;
  }, [mode, paths, selectedRulePath]);

  const pathExamples = useMemo(
    () => ({
      unix: {
        rules: '~/.factory/rules/*.md',
        memory: '~/.factory/memories.md',
        agents: '~/.factory/AGENTS.md',
      },
      windows: {
        rules: '%USERPROFILE%\\.factory\\rules\\*.md',
        memory: '%USERPROFILE%\\.factory\\memories.md',
        agents: '%USERPROFILE%\\.factory\\AGENTS.md',
      },
    }),
    []
  );

  const isDirty = content !== savedContent;

  const loadFileContent = useCallback(async (filePath: string | null) => {
    if (!filePath) {
      setContent('');
      setSavedContent('');
      return;
    }

    setContentLoading(true);
    try {
      const nextContent = ((await ipcBridge.fs.readFile.invoke({ path: filePath })) as string | null) ?? '';
      setContent(nextContent);
      setSavedContent(nextContent);
    } catch (error) {
      console.error('[FactoryGlobalSettings] Failed to read file:', error);
      messageApiRef.current.error(
        tRef.current('settings.factoryGlobal.loadFailed', { defaultValue: 'Failed to load file' })
      );
      setContent('');
      setSavedContent('');
    } finally {
      setContentLoading(false);
    }
  }, []);

  const refreshRules = useCallback(async (): Promise<IFactoryRuleFile[]> => {
    const files = await ipcBridge.fs.listFactoryRuleFiles.invoke();
    setRuleFiles(files);
    setSelectedRulePath((currentPath) => {
      if (currentPath && files.some((file) => file.path === currentPath)) {
        return currentPath;
      }

      return files[0]?.path ?? null;
    });
    return files;
  }, []);

  const loadCurrentMode = useCallback(async () => {
    setLoading(true);
    try {
      const nextPaths = await ipcBridge.fs.getFactoryGlobalPaths.invoke();
      setPaths(nextPaths);

      if (mode === 'rules') {
        await refreshRules();
      } else {
        await loadFileContent(mode === 'memory' ? nextPaths.memoriesFile : nextPaths.agentsFile);
      }
    } catch (error) {
      console.error('[FactoryGlobalSettings] Failed to load settings state:', error);
      messageApiRef.current.error(
        tRef.current('settings.factoryGlobal.loadFailed', { defaultValue: 'Failed to load file' })
      );
    } finally {
      setLoading(false);
    }
  }, [loadFileContent, mode, refreshRules]);

  useEffect(() => {
    void loadCurrentMode();
  }, [loadCurrentMode]);

  useEffect(() => {
    if (!isRulesMode) {
      return;
    }

    void loadFileContent(selectedRulePath);
  }, [isRulesMode, loadFileContent, selectedRulePath]);

  const saveCurrentFile = useCallback(
    async (showSuccessMessage = true): Promise<boolean> => {
      if (!activeFilePath) {
        return false;
      }

      setSaving(true);
      try {
        await ipcBridge.fs.writeFile.invoke({
          path: activeFilePath,
          data: content,
        });
        setSavedContent(content);

        if (mode === 'rules') {
          await refreshRules();
        }

        if (showSuccessMessage) {
          messageApi.success(t('settings.factoryGlobal.saveSuccess', { defaultValue: 'Saved successfully' }));
        }
        return true;
      } catch (error) {
        console.error('[FactoryGlobalSettings] Failed to save file:', error);
        messageApi.error(t('settings.factoryGlobal.saveFailed', { defaultValue: 'Failed to save file' }));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [activeFilePath, content, messageApi, mode, refreshRules, t]
  );

  const handleSelectRule = useCallback(
    async (nextPath: string) => {
      if (nextPath === selectedRulePath) {
        return;
      }

      if (isDirty) {
        const saved = await saveCurrentFile(false);
        if (!saved) {
          return;
        }
      }

      setSelectedRulePath(nextPath);
    },
    [isDirty, saveCurrentFile, selectedRulePath]
  );

  const handleRefresh = useCallback(async () => {
    if (mode === 'rules') {
      const files = await refreshRules();
      const nextSelectedPath =
        selectedRulePath && files.some((file) => file.path === selectedRulePath)
          ? selectedRulePath
          : (files[0]?.path ?? null);
      await loadFileContent(nextSelectedPath);
      return;
    }

    await loadFileContent(activeFilePath);
  }, [activeFilePath, loadFileContent, mode, refreshRules, selectedRulePath]);

  const handleCreateRule = useCallback(async () => {
    if (!paths) {
      return;
    }

    const fileName = normalizeRuleFileName(newRuleFileName);
    if (!fileName) {
      messageApi.warning(
        t('settings.factoryGlobal.ruleFileNameRequired', {
          defaultValue: 'Please enter a valid rule file name',
        })
      );
      return;
    }

    const targetPath = joinPlatformPath(paths.rulesDir, fileName, paths.platform);
    const initialContent = `# ${fileName.replace(/\.md$/i, '')}\n`;

    try {
      await ipcBridge.fs.writeFile.invoke({ path: targetPath, data: initialContent });
      setCreateRuleVisible(false);
      setNewRuleFileName('');
      await refreshRules();
      setSelectedRulePath(targetPath);
      messageApi.success(t('settings.factoryGlobal.ruleCreated', { defaultValue: 'Rule file created' }));
    } catch (error) {
      console.error('[FactoryGlobalSettings] Failed to create rule file:', error);
      messageApi.error(t('settings.factoryGlobal.saveFailed', { defaultValue: 'Failed to save file' }));
    }
  }, [messageApi, newRuleFileName, paths, refreshRules, t]);

  const renderPathGuideTrigger = () => {
    if (!paths) {
      return null;
    }

    const currentPath = isRulesMode ? paths.rulesDir : activeFilePath;

    return (
      <Popover
        trigger='hover'
        position='bottom'
        content={
          <div className='max-w-420px flex flex-col gap-10px p-4px'>
            <Typography.Text className='text-13px font-medium text-t-primary'>
              {t('settings.factoryGlobal.globalOnly', {
                defaultValue: 'This page only manages the global user-level official Factory structure.',
              })}
            </Typography.Text>
            {currentPath && (
              <div className='flex flex-col gap-4px'>
                <Typography.Text type='secondary' className='text-12px'>
                  {t('settings.factoryGlobal.currentPath', { defaultValue: 'Current path' })}
                </Typography.Text>
                <Typography.Paragraph copyable={{ text: currentPath }} className='!mb-0 !break-all text-12px'>
                  {currentPath}
                </Typography.Paragraph>
              </div>
            )}
            <div className='flex flex-col gap-4px'>
              <Typography.Text type='secondary' className='text-12px'>
                {t('settings.factoryGlobal.pathExamples', {
                  defaultValue: 'Official path examples by operating system',
                })}
              </Typography.Text>
              <Typography.Text className='text-12px text-t-primary leading-18px'>
                macOS / Linux: {pathExamples.unix.rules} · {pathExamples.unix.memory} · {pathExamples.unix.agents}
              </Typography.Text>
              <Typography.Text className='text-12px text-t-primary leading-18px'>
                Windows: {pathExamples.windows.rules} · {pathExamples.windows.memory} · {pathExamples.windows.agents}
              </Typography.Text>
            </div>
          </div>
        }
      >
        <Button
          type='text'
          size='mini'
          shape='circle'
          icon={<Info theme='outline' size='14' />}
          className='!h-22px !w-22px !min-w-22px !p-0 text-t-secondary'
          data-testid='factory-global-info-trigger'
        />
      </Popover>
    );
  };

  const renderEditor = () => {
    if (contentLoading) {
      return (
        <div className='min-h-420px flex items-center justify-center'>
          <Spin />
        </div>
      );
    }

    if (isRulesMode && !activeFilePath) {
      return (
        <div className='min-h-420px flex items-center justify-center border border-dashed border-b-base rd-12px'>
          <Empty
            description={t('settings.factoryGlobal.noRuleSelected', {
              defaultValue: 'Select a rule file or create a new one to start editing.',
            })}
          />
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-8px'>
        {activeFilePath && (
          <div className='flex flex-col gap-4px'>
            <Typography.Text type='secondary' className='text-13px'>
              {t('settings.factoryGlobal.currentFile', { defaultValue: 'Current file' })}
            </Typography.Text>
            <Typography.Paragraph copyable={{ text: activeFilePath }} className='!mb-0 !break-all text-13px'>
              {activeFilePath}
            </Typography.Paragraph>
          </div>
        )}
        <Input.TextArea
          value={content}
          onChange={setContent}
          autoSize={{ minRows: 24, maxRows: 36 }}
          placeholder={t('settings.factoryGlobal.editorPlaceholder', {
            defaultValue: 'Enter Markdown content here...',
          })}
          className='font-mono'
        />
      </div>
    );
  };

  const renderRulesLayout = () => {
    return (
      <div className='flex flex-col gap-12px md:flex-row'>
        <div className='w-full md:w-240px md:shrink-0'>
          <div className='flex items-center justify-between mb-12px'>
            <Typography.Text className='text-14px font-medium text-t-primary'>
              {t('settings.factoryGlobal.rulesListTitle', { defaultValue: 'Rule files' })}
            </Typography.Text>
            <Button type='text' size='small' icon={<Plus />} onClick={() => setCreateRuleVisible(true)}>
              {t('settings.factoryGlobal.createRuleFile', { defaultValue: 'New file' })}
            </Button>
          </div>
          {ruleFiles.length === 0 ? (
            <div className='border border-dashed border-b-base rd-12px py-24px px-12px bg-fill-1'>
              <Empty
                description={t('settings.factoryGlobal.ruleListEmpty', {
                  defaultValue: 'No global rule files found in ~/.factory/rules yet.',
                })}
              />
            </div>
          ) : (
            <div className='border border-b-base rd-12px bg-base overflow-hidden'>
              <Menu
                selectedKeys={selectedRulePath ? [selectedRulePath] : []}
                onClickMenuItem={(key) => {
                  void handleSelectRule(String(key));
                }}
              >
                {ruleFiles.map((file) => (
                  <Menu.Item key={file.path}>
                    <div className='flex items-center gap-8px'>
                      <FileText theme='outline' size='16' />
                      <span className='truncate'>{file.name}</span>
                    </div>
                  </Menu.Item>
                ))}
              </Menu>
            </div>
          )}
        </div>
        <div className='min-w-0 flex-1 border border-b-base bg-base rd-16px p-16px md:p-20px'>{renderEditor()}</div>
      </div>
    );
  };

  return (
    <>
      {messageContext}
      <SettingsPageWrapper contentClassName={isRulesMode ? 'max-w-1200px' : 'max-w-1024px'}>
        <div className='flex flex-col gap-12px'>
          <div className='border border-b-base bg-base rd-16px p-20px md:p-24px flex flex-col gap-12px'>
            <div className='flex flex-col gap-12px md:flex-row md:items-start md:justify-between'>
              <div className='flex items-start gap-12px'>
                <div className='w-36px h-36px rd-10px bg-fill-1 flex items-center justify-center text-t-primary shrink-0'>
                  {mode === 'agents-md' ? <Write theme='outline' size='18' /> : <FileText theme='outline' size='18' />}
                </div>
                <div className='flex flex-col gap-4px'>
                  <div className='flex items-center gap-6px'>
                    <Typography.Text className='text-18px font-semibold text-t-primary'>
                      {pageMeta.title}
                    </Typography.Text>
                    {renderPathGuideTrigger()}
                  </div>
                  <Typography.Text type='secondary' className='text-13px leading-20px'>
                    {pageMeta.description}
                  </Typography.Text>
                </div>
              </div>
              <div className='flex items-center gap-8px'>
                <Button icon={<Refresh />} onClick={() => void handleRefresh()} disabled={loading || contentLoading}>
                  {t('common.refresh', { defaultValue: 'Refresh' })}
                </Button>
                <Button
                  type='primary'
                  onClick={() => void saveCurrentFile()}
                  loading={saving}
                  disabled={!activeFilePath || !isDirty}
                >
                  {t('common.save', { defaultValue: 'Save' })}
                </Button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className='border border-b-base bg-base rd-16px p-24px min-h-320px flex items-center justify-center'>
              <Spin />
            </div>
          ) : isRulesMode ? (
            renderRulesLayout()
          ) : (
            <div className='border border-b-base bg-base rd-16px p-16px md:p-20px'>{renderEditor()}</div>
          )}
        </div>
      </SettingsPageWrapper>

      <Modal
        title={t('settings.factoryGlobal.createRuleFileTitle', { defaultValue: 'Create rule file' })}
        visible={createRuleVisible}
        onCancel={() => {
          setCreateRuleVisible(false);
          setNewRuleFileName('');
        }}
        onOk={() => void handleCreateRule()}
        okText={t('common.create', { defaultValue: 'Create' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        okButtonProps={{ disabled: !normalizeRuleFileName(newRuleFileName) }}
      >
        <div className='flex flex-col gap-12px'>
          <Typography.Text type='secondary'>
            {t('settings.factoryGlobal.createRuleHint', {
              defaultValue: 'Rule files are stored under ~/.factory/rules and must use the .md extension.',
            })}
          </Typography.Text>
          <Input
            value={newRuleFileName}
            onChange={setNewRuleFileName}
            placeholder={t('settings.factoryGlobal.ruleFileNamePlaceholder', {
              defaultValue: 'e.g. style-guide.md',
            })}
          />
        </div>
      </Modal>
    </>
  );
};

export default FactoryGlobalSettings;
