/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OfficeCli Bridge
 *
 * Exposes the shared `OfficeCliInstaller` service over IPC so the renderer can
 * query install status and manually trigger installation from the viewer's
 * failure card. The install itself is executed by `OfficeCliInstaller`; this
 * module only wires the service to the bridge framework.
 */

import { ipcBridge } from '@/common';
import {
  getOfficecliStatus,
  installOfficecli,
  type OfficeCliInstallStatus,
} from '@process/bridge/services/OfficeCliInstaller';

export function initOfficeCliBridge(): void {
  ipcBridge.officeCli.getOfficecliStatus.provider(async () => {
    return { success: true, data: { status: getOfficecliStatus() } };
  });

  ipcBridge.officeCli.installOfficecli.provider(async () => {
    let lastStatus: OfficeCliInstallStatus = getOfficecliStatus();
    const ok = await installOfficecli((status) => {
      lastStatus = status;
    });
    return { success: true, data: { ok, status: lastStatus } };
  });
}
