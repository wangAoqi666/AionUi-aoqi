/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import React from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import McpManagement from './ToolsSettings/McpManagement';

const McpSettings: React.FC = () => {
  const [messageApi, messageContext] = Message.useMessage();

  return (
    <SettingsPageWrapper>
      {messageContext}
      <McpManagement message={messageApi} />
    </SettingsPageWrapper>
  );
};

export default McpSettings;
