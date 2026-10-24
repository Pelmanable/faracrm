/**
 * Загрузка файла частями (/attachments/uploads): файл любого размера уходит
 * кусками по part_size по порядку — каждый запрос маленький, лимиты nginx
 * не мешают, base64 нет. Обрыв сети — докачка с позиции, которую знает
 * сервер. Готовый upload_id передаётся вместо content: при создании
 * вложения, в PUT вложения.
 *
 * Пока идёт хоть одна загрузка, закрытие или обновление вкладки браузер
 * переспрашивает: после него выбранный файл потерян, докачать нельзя.
 *
 * Использование:
 *   const uploadFile = useUploadFile();
 *   const uploadId = await uploadFile(file, { name: file.name, onProgress });
 */
import { useCallback } from 'react';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import {
  useAbortUploadMutation,
  useGetUploadOffsetMutation,
  useStartUploadMutation,
  useUploadPartMutation,
} from '@/services/api/attachments';

// Повторы части после обрыва сети, пауза растёт с каждым
const RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Загрузки во всей вкладке — из любых форм, панелей, редакторов
let activeUploads = 0;

function confirmUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  // Старые Chrome и Safari спрашивают только по returnValue
  event.returnValue = '';
}

/** Выполнить загрузку, переспрашивая при закрытии вкладки, пока она идёт. */
async function whileUploading<T>(run: () => Promise<T>): Promise<T> {
  if (activeUploads++ === 0) {
    window.addEventListener('beforeunload', confirmUnload);
  }
  try {
    return await run();
  } finally {
    if (--activeUploads === 0) {
      window.removeEventListener('beforeunload', confirmUnload);
    }
  }
}

export interface UploadFileOptions {
  name: string;
  mimetype?: string;
  /** Загрузка началась: upload_id уже есть, файл ещё грузится. */
  onStart?: (uploadId: number) => void;
  /** Сколько байт получил сервер. */
  onProgress?: (loaded: number, total: number) => void;
  /** Отмена: загрузка на сервере удаляется, промис отклоняется. */
  signal?: AbortSignal;
}

export function useUploadFile() {
  const [startUpload] = useStartUploadMutation();
  const [uploadPart] = useUploadPartMutation();
  const [getUploadOffset] = useGetUploadOffsetMutation();
  const [abortUpload] = useAbortUploadMutation();

  return useCallback(
    (
      file: Blob,
      { name, mimetype, onStart, onProgress, signal }: UploadFileOptions,
    ): Promise<number> =>
      whileUploading(async () => {
        const session = await startUpload({
          name,
          mimetype,
          size: file.size,
        }).unwrap();

        let offset = session.offset;
        let failures = 0;
        try {
          // Отменили, пока открывалась загрузка, — upload_id уже не нужен
          signal?.throwIfAborted();
          onStart?.(session.id);
          while (offset < file.size) {
            signal?.throwIfAborted();
            const request = uploadPart({
              id: session.id,
              offset,
              part: file.slice(offset, offset + session.part_size),
            });
            const abort = () => request.abort();
            signal?.addEventListener('abort', abort);
            try {
              ({ offset } = await request.unwrap());
              failures = 0;
            } catch (error) {
              signal?.throwIfAborted();
              const { status, data } = error as FetchBaseQueryError;
              // Часть с другой позиции уже дошла (повтор после обрыва) —
              // продолжаем с той, что ждёт сервер
              if (status === 409) {
                offset = (data as { offset: number }).offset;
                continue;
              }
              if (status !== 'FETCH_ERROR' || ++failures > RETRIES) throw error;
              await new Promise(resolve =>
                setTimeout(resolve, RETRY_DELAY_MS * failures),
              );
              ({ offset } = await getUploadOffset(session.id).unwrap());
            } finally {
              signal?.removeEventListener('abort', abort);
            }
            onProgress?.(offset, file.size);
          }
        } catch (error) {
          abortUpload(session.id);
          throw error;
        }
        return session.id;
      }),
    [startUpload, uploadPart, getUploadOffset, abortUpload],
  );
}
