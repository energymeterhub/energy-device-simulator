import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface PersistedSelectionState {
  version: 2;
  selectedProfileId: string;
}

interface LegacyPersistedSelectionState {
  version: 1;
  selectedDevice?: {
    profileId?: unknown;
  };
}

function normalizeProfileId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function loadPersistedProfileId(
  stateFilePath: string | null | undefined
): string | null {
  if (!stateFilePath) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(stateFilePath, 'utf8')) as
      | Partial<PersistedSelectionState>
      | Partial<LegacyPersistedSelectionState>;

    if (raw.version === 2) {
      return normalizeProfileId(raw.selectedProfileId);
    }

    if (raw.version !== 1) {
      return null;
    }

    return normalizeProfileId(raw.selectedDevice?.profileId);
  } catch {
    return null;
  }
}

export async function savePersistedProfileId(
  stateFilePath: string | null | undefined,
  profileId: string
): Promise<void> {
  if (!stateFilePath) {
    return;
  }

  const payload: PersistedSelectionState = {
    version: 2,
    selectedProfileId: profileId
  };

  await mkdir(path.dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, JSON.stringify(payload, null, 2));
}
