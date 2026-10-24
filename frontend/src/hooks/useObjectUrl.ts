import { useEffect, useState } from 'react';

/**
 * Ссылка blob: на файл в памяти браузера — показать ещё не сохранённый
 * файл в <img>, <video>, окне просмотра без base64. Отзывается при смене
 * файла и размонтировании.
 */
export function useObjectUrl(file: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}
