import { useCallback, useState } from 'react';
import type { SetStateAction } from 'react';
import type { SignatureSetting } from './api';
import { htmlToText, signatureHasText, textToHtml } from './draft';

interface MessageDraft {
  key: string;
  isEmail: boolean;
  value: string;
}

function currentMessage(
  draft: MessageDraft,
  key: string,
  isEmail: boolean,
): string {
  if (draft.key !== key) return '';
  if (draft.isEmail === isEmail) return draft.value;
  return isEmail ? textToHtml(draft.value) : htmlToText(draft.value);
}

export function useMessageDraft(
  chatId: number,
  isEmail: boolean,
  userId: number,
) {
  const key = `${userId}:${chatId}`;
  const [draft, setDraft] = useState({ key, isEmail, value: '' });
  const current = currentMessage(draft, key, isEmail);

  const setValue = useCallback(
    (value: SetStateAction<string>) => {
      setDraft(previous => {
        const previousValue = currentMessage(previous, key, isEmail);
        return {
          key,
          isEmail,
          value: typeof value === 'function' ? value(previousValue) : value,
        };
      });
    },
    [key, isEmail],
  );

  return [current, setValue] as const;
}

interface SignatureDraftOptions {
  userId: number;
  chatId: number;
  connectorId?: number;
  setting?: SignatureSetting;
  isEmail: boolean;
  hasText: boolean;
  disabled: boolean;
}

export function useSignatureDraft({
  userId,
  chatId,
  connectorId,
  setting,
  isEmail,
  hasText,
  disabled,
}: SignatureDraftOptions) {
  const [cycle, setCycle] = useState(0);
  const [override, setOverride] = useState<{
    key: string;
    body: string | null;
  } | null>(null);
  const key = `${userId}:${chatId}:${connectorId ?? 0}:${cycle}`;
  const available =
    !!connectorId &&
    !!setting &&
    setting.format === (isEmail ? 'html' : 'text') &&
    signatureHasText(setting.body, isEmail);
  const scoped = override?.key === key ? override : null;
  const body =
    !disabled && available
      ? scoped
        ? scoped.body
        : setting.auto_insert && hasText
          ? setting.body
          : null
      : null;
  const reset = useCallback(() => {
    setOverride(null);
    setCycle(previous => previous + 1);
  }, []);

  return {
    body,
    available,
    insert: () => setOverride({ key, body: setting?.body ?? null }),
    change: (value: string) => setOverride({ key, body: value }),
    remove: () => setOverride({ key, body: null }),
    reset,
  };
}
