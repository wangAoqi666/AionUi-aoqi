/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import ConversationSearchPopover from '@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

export const GLOBAL_SIDER_SEARCH_SLOT_ID = 'layout-global-sider-search-slot';

interface SiderSearchEntryProps {
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onConversationSelect: () => void;
  onSessionClick?: () => void;
  portalTargetId?: string;
  portalWrapperClassName?: string;
}

const SiderSearchEntry: React.FC<SiderSearchEntryProps> = ({
  isMobile,
  collapsed,
  siderTooltipProps,
  onConversationSelect,
  onSessionClick,
  portalTargetId,
  portalWrapperClassName,
}) => {
  const { t } = useTranslation();
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    if (!portalTargetId || typeof document === 'undefined') {
      setPortalTarget(null);
      return;
    }

    setPortalTarget(document.getElementById(portalTargetId));
  }, [portalTargetId]);

  const content = collapsed ? (
    <Tooltip {...siderTooltipProps} content={t('conversation.historySearch.tooltip')} position='right'>
      <div className='w-full'>
        <ConversationSearchPopover
          onSessionClick={onSessionClick}
          onConversationSelect={onConversationSelect}
          label={t('conversation.historySearch.shortTitle')}
          buttonClassName='!w-full !h-auto !py-6px !px-0 !justify-center !rd-8px !hover:bg-fill-3 !active:bg-fill-4'
        />
      </div>
    </Tooltip>
  ) : (
    <Tooltip {...siderTooltipProps} content={t('conversation.historySearch.tooltip')} position='right'>
      <div className='w-full'>
        <ConversationSearchPopover
          onSessionClick={onSessionClick}
          onConversationSelect={onConversationSelect}
          label={t('conversation.historySearch.shortTitle')}
          fullWidth
          buttonClassName={classNames(isMobile && 'sider-action-btn-mobile')}
        />
      </div>
    </Tooltip>
  );

  if (!portalTargetId) {
    return content;
  }

  if (!portalTarget) {
    return null;
  }

  return createPortal(
    portalWrapperClassName ? <div className={portalWrapperClassName}>{content}</div> : content,
    portalTarget
  );
};

export default SiderSearchEntry;
