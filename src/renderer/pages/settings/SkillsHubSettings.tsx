/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Empty, Input, Message, Modal, Popover, Spin, Typography } from '@arco-design/web-react';
import { Delete, FolderOpen, Info, Refresh, Search } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

type SkillInfo = {
  name: string;
  description: string;
  location: string;
  isCustom: boolean;
};

const importFolderSkills = async (
  folderPath: string,
  importSkill: (skillPath: string) => Promise<boolean>
): Promise<{ imported: number; skipped: number }> => {
  const response = await ipcBridge.fs.scanForSkills.invoke({ folderPath });
  if (!response.success || !response.data || response.data.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  const results = await Promise.all(response.data.map(async (skill) => importSkill(skill.path)));
  const imported = results.filter(Boolean).length;
  const skipped = results.length - imported;

  return { imported, skipped };
};

const SkillsHubSettings: React.FC = () => {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [skillPaths, setSkillPaths] = useState<{ userSkillsDir: string; builtinSkillsDir: string } | null>(null);

  const filteredSkills = useMemo(() => {
    const customSkills = skills.filter((skill) => skill.isCustom);
    const keyword = searchQuery.trim().toLowerCase();

    if (!keyword) {
      return customSkills;
    }

    return customSkills.filter((skill) => {
      return skill.name.toLowerCase().includes(keyword) || skill.description.toLowerCase().includes(keyword);
    });
  }, [searchQuery, skills]);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const [availableSkills, paths] = await Promise.all([
        ipcBridge.fs.listAvailableSkills.invoke(),
        ipcBridge.fs.getSkillPaths.invoke(),
      ]);
      setSkills(availableSkills.filter((skill) => skill.isCustom));
      setSkillPaths(paths);
    } catch (error) {
      console.error('[SkillsHubSettings] Failed to load skills:', error);
      Message.error(tRef.current('settings.skillsHub.fetchError', { defaultValue: 'Failed to fetch skills' }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const importSingleSkill = useCallback(async (skillPath: string): Promise<boolean> => {
    try {
      const result = await ipcBridge.fs.importSkillWithSymlink.invoke({ skillPath });
      if (!result.success) {
        return false;
      }
      return true;
    } catch (error) {
      console.error('[SkillsHubSettings] Failed to import skill:', error);
      return false;
    }
  }, []);

  const handleImportFromFolder = useCallback(async () => {
    const selected = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openDirectory'],
    });

    if (!selected || selected.length === 0) {
      return;
    }

    const folderPath = selected[0];
    setImporting(true);

    try {
      const scanResponse = await ipcBridge.fs.scanForSkills.invoke({ folderPath });
      if (!scanResponse.success || !scanResponse.data || scanResponse.data.length === 0) {
        Message.warning(
          t('settings.skillsHub.noSkillsInFolder', {
            defaultValue: 'No SKILL.md files were found in the selected folder.',
          })
        );
        return;
      }

      if (scanResponse.data.length > 1) {
        Modal.confirm({
          title: t('settings.skillsHub.importManyTitle', { defaultValue: 'Import skills from folder' }),
          content: t('settings.skillsHub.importManyContent', {
            count: scanResponse.data.length,
            defaultValue: 'Found {{count}} skills in this folder. Import all of them?',
          }),
          onOk: async () => {
            const { imported, skipped } = await importFolderSkills(folderPath, importSingleSkill);
            await loadSkills();
            Message.success(
              t('settings.skillsHub.importSummary', {
                imported,
                skipped,
                defaultValue: 'Imported {{imported}} skills, skipped {{skipped}} existing items.',
              })
            );
          },
        });
        return;
      }

      const imported = await importSingleSkill(scanResponse.data[0].path);
      await loadSkills();

      if (imported) {
        Message.success(t('settings.skillsHub.importSuccess', { defaultValue: 'Skill imported successfully' }));
      } else {
        Message.warning(
          t('settings.skillsHub.importSkipped', {
            defaultValue: 'The selected skill already exists or could not be imported.',
          })
        );
      }
    } catch (error) {
      console.error('[SkillsHubSettings] Failed to import folder:', error);
      Message.error(t('settings.skillsHub.importError', { defaultValue: 'Error importing skill' }));
    } finally {
      setImporting(false);
    }
  }, [importSingleSkill, loadSkills, t]);

  const handleDeleteSkill = useCallback(
    (skillName: string) => {
      Modal.confirm({
        title: t('settings.skillsHub.deleteConfirmTitle', { defaultValue: 'Delete Skill' }),
        content: t('settings.skillsHub.deleteConfirmContent', {
          name: skillName,
          defaultValue: 'Are you sure you want to delete "{{name}}"?',
        }),
        okButtonProps: { status: 'danger' },
        onOk: async () => {
          try {
            const result = await ipcBridge.fs.deleteSkill.invoke({ skillName });
            if (result.success) {
              await loadSkills();
              Message.success(t('settings.skillsHub.deleteSuccess', { defaultValue: 'Skill deleted' }));
              return;
            }

            Message.error(
              result.msg || t('settings.skillsHub.deleteFailed', { defaultValue: 'Failed to delete skill' })
            );
          } catch (error) {
            console.error('[SkillsHubSettings] Failed to delete skill:', error);
            Message.error(t('settings.skillsHub.deleteError', { defaultValue: 'Error deleting skill' }));
          }
        },
      });
    },
    [loadSkills, t]
  );

  const renderPathGuideTrigger = () => {
    return (
      <Popover
        trigger='hover'
        position='bottom'
        content={
          <div className='max-w-420px flex flex-col gap-10px p-4px'>
            <Typography.Text className='text-13px font-medium text-t-primary'>
              {t('settings.skillsHub.globalOnly', {
                defaultValue: 'This page only shows the global user-level official Factory skills directory.',
              })}
            </Typography.Text>
            {skillPaths?.userSkillsDir && (
              <div className='flex flex-col gap-4px'>
                <Typography.Text type='secondary' className='text-12px'>
                  {t('settings.skillsHub.officialPathLabel', { defaultValue: 'Current path' })}
                </Typography.Text>
                <Typography.Paragraph
                  copyable={{ text: skillPaths.userSkillsDir }}
                  className='!mb-0 !break-all text-12px'
                >
                  {skillPaths.userSkillsDir}
                </Typography.Paragraph>
              </div>
            )}
            <div className='flex flex-col gap-4px'>
              <Typography.Text type='secondary' className='text-12px'>
                {t('settings.skillsHub.pathExamples', {
                  defaultValue: 'Official path examples by operating system',
                })}
              </Typography.Text>
              <Typography.Text className='text-12px text-t-primary leading-18px'>
                macOS / Linux: ~/.factory/skills/&lt;name&gt;/SKILL.md
              </Typography.Text>
              <Typography.Text className='text-12px text-t-primary leading-18px'>
                Windows: %USERPROFILE%\.factory\skills\&lt;name&gt;\SKILL.md
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
          data-testid='skills-hub-info-trigger'
        />
      </Popover>
    );
  };

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <div className='flex flex-col gap-12px'>
        <div className='border border-b-base bg-base rd-16px p-20px md:p-24px flex flex-col gap-12px'>
          <div className='flex flex-col gap-12px md:flex-row md:items-start md:justify-between'>
            <div className='flex flex-col gap-4px'>
              <div className='flex items-center gap-6px'>
                <Typography.Text className='text-18px font-semibold text-t-primary'>
                  {t('settings.skillsHub.title', { defaultValue: 'Skills Hub' })}
                </Typography.Text>
                {renderPathGuideTrigger()}
              </div>
              <Typography.Text type='secondary' className='text-13px leading-20px'>
                {t('settings.skillsHub.officialDescription', {
                  defaultValue: 'Manage global user skills in the official ~/.factory/skills directory only.',
                })}
              </Typography.Text>
            </div>
            <div className='flex items-center gap-8px'>
              <Button icon={<Refresh />} onClick={() => void loadSkills()} loading={loading}>
                {t('common.refresh', { defaultValue: 'Refresh' })}
              </Button>
              <Button
                type='primary'
                icon={<FolderOpen />}
                onClick={() => void handleImportFromFolder()}
                loading={importing}
              >
                {t('settings.skillsHub.manualImport', { defaultValue: 'Import from Folder' })}
              </Button>
            </div>
          </div>
        </div>

        <div className='border border-b-base bg-base rd-16px p-20px md:p-24px flex flex-col gap-16px'>
          <div className='flex flex-col gap-12px md:flex-row md:items-center md:justify-between'>
            <div className='flex flex-col gap-4px'>
              <Typography.Text className='text-16px font-semibold text-t-primary'>
                {t('settings.skillsHub.mySkillsTitle', { defaultValue: 'My Skills' })}
              </Typography.Text>
              <Typography.Text type='secondary' className='text-13px'>
                {t('settings.skillsHub.customOnlyHint', {
                  defaultValue:
                    'Built-in bundled skills are not shown here. This page only manages user skills stored under ~/.factory/skills.',
                })}
              </Typography.Text>
            </div>
            <Input
              allowClear
              prefix={<Search size={16} />}
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('settings.skillsHub.searchPlaceholder', { defaultValue: 'Search skills...' })}
              className='w-full md:!w-280px'
            />
          </div>

          {loading ? (
            <div className='min-h-320px flex items-center justify-center'>
              <Spin />
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className='border border-dashed border-b-base rd-12px py-32px bg-fill-1'>
              <Empty
                description={
                  skills.length === 0
                    ? t('settings.skillsHub.noSkills', {
                        defaultValue:
                          'No global skills found. Import a folder to create your first official ~/.factory skill.',
                      })
                    : t('settings.skillsHub.noSearchResults', { defaultValue: 'No matching skills found' })
                }
              />
            </div>
          ) : (
            <div className='flex flex-col gap-12px'>
              {filteredSkills.map((skill) => (
                <div
                  key={skill.name}
                  className='border border-b-base bg-fill-1 rd-12px p-16px flex flex-col gap-12px md:flex-row md:items-start md:justify-between'
                >
                  <div className='flex flex-col gap-6px min-w-0'>
                    <Typography.Text className='text-14px font-medium text-t-primary'>{skill.name}</Typography.Text>
                    {skill.description ? (
                      <Typography.Text type='secondary' className='text-13px leading-20px'>
                        {skill.description}
                      </Typography.Text>
                    ) : null}
                    <Typography.Paragraph
                      copyable={{ text: skill.location }}
                      className='!mb-0 !break-all text-12px text-t-tertiary'
                    >
                      {skill.location}
                    </Typography.Paragraph>
                  </div>
                  <div className='flex justify-end'>
                    <Button status='danger' icon={<Delete />} onClick={() => handleDeleteSkill(skill.name)}>
                      {t('common.delete', { defaultValue: 'Delete' })}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SkillsHubSettings;
