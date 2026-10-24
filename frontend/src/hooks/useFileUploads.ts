/**
 * Файлы, которые грузятся частями сразу при выборе (форма, поля, чат,
 * импорт): сам файл — для превью и скачивания, процент — по ключу.
 * Повторный start с тем же ключом отменяет прошлую загрузку, уход со
 * страницы — все.
 *
 * Использование:
 *   const uploads = useFileUploads();
 *   const uploadId = await uploads.start('file', file, onStart);
 *   uploads.files.file, uploads.progress.file
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUploadFile } from './useUploadFile';

/** MIME-тип файла; браузер не знает — двоичный. */
export const fileMimetype = (file: File) =>
  file.type || 'application/octet-stream';

export function useFileUploads() {
  const uploadFile = useUploadFile();
  const [files, setFiles] = useState<Record<string, File>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach(controller => controller.abort());
  }, []);

  /** Отменить загрузку и забыть файл. */
  const forget = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setFiles(({ [key]: _, ...rest }) => rest);
    setProgress(({ [key]: _, ...rest }) => rest);
  }, []);

  /**
   * Загрузить файл. Returns: upload_id; null — загрузку отменили (forget,
   * новый start с тем же ключом, уход со страницы). Ошибка — исключение,
   * файл забыт.
   */
  const start = useCallback(
    async (
      key: string,
      file: File,
      onStart?: (uploadId: number) => void,
    ): Promise<number | null> => {
      controllers.current.get(key)?.abort();
      const controller = new AbortController();
      controllers.current.set(key, controller);
      setFiles(prev => ({ ...prev, [key]: file }));
      setProgress(prev => ({ ...prev, [key]: 0 }));
      try {
        const uploadId = await uploadFile(file, {
          name: file.name,
          mimetype: fileMimetype(file),
          signal: controller.signal,
          onStart,
          onProgress: (loaded, total) =>
            setProgress(prev => ({ ...prev, [key]: (loaded / total) * 100 })),
        });
        // Пока дошла, ключ заняла новая загрузка — эта уже не нужна
        if (controllers.current.get(key) !== controller) return null;
        controllers.current.delete(key);
        setProgress(({ [key]: _, ...rest }) => rest);
        return uploadId;
      } catch (error) {
        if (controller.signal.aborted) return null;
        forget(key);
        throw error;
      }
    },
    [uploadFile, forget],
  );

  return { files, progress, start, forget };
}
