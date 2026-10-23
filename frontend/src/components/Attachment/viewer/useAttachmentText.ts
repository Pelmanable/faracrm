import { useEffect, useState } from 'react';
import { attachmentContentUrl } from '@/utils/attachmentUrls';

// Текст на десятки мегабайт (логи) подвешивает вкладку — показываем начало
const MAX_CHARS = 1_000_000;

/** Содержимое вложения как текст (UTF-8) — для окна просмотра. */
export function useAttachmentText(attachmentId: number) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(attachmentContentUrl(attachmentId), { credentials: 'include' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(value => {
        if (cancelled) return;
        setTruncated(value.length > MAX_CHARS);
        setText(value.slice(0, MAX_CHARS));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  return { text, truncated, error };
}
