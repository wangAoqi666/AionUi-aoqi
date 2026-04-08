import { ipcBridge } from '@/common';
import { Spin } from '@arco-design/web-react';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';
import ChatConversation from './components/ChatConversation';
import { useConversationTabs } from './hooks/ConversationTabsContext';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';

const ChatConversationIndex: React.FC = () => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { openTab } = useConversationTabs();
  const { syncTitleFromHistory } = useAutoTitle();
  const defaultConversationTitle = t('conversation.welcome.newConversation');

  const { data, isLoading, mutate } = useSWR(`conversation/${id}`, () => {
    return ipcBridge.conversation.get.invoke({ id });
  });

  useEffect(() => {
    if (!id) return;

    return ipcBridge.conversation.listChanged.on((event) => {
      if (event.conversationId !== id || event.action !== 'updated') {
        return;
      }

      void mutate();
    });
  }, [id, mutate]);

  useEffect(() => {
    if (!data || data.name !== defaultConversationTitle) {
      return;
    }

    void syncTitleFromHistory(data.id);
  }, [data, defaultConversationTitle, syncTitleFromHistory]);

  // 当会话数据加载完成后，自动打开 tab
  // Automatically open tab when conversation data is loaded
  useEffect(() => {
    if (data) {
      openTab(data);
    }
  }, [data, openTab]);

  if (isLoading) return <Spin loading></Spin>;
  return <ChatConversation conversation={data}></ChatConversation>;
};

export default ChatConversationIndex;
