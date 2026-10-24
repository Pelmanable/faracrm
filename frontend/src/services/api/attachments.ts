import { crudApi } from './crudApi';

/**
 * attachments.ts — re-exports from canonical records.ts
 * @deprecated Import directly from '@/types/records' instead
 */
export { type AttachmentRecord as Attachment } from '@/types/records';
export { type AttachmentStorageRecord as SchemaAttachmentStorage } from '@/types/records';
export type { AttachmentRouteRecord } from '@/types/records';

/** Письмо .eml, разобранное сервером (GET /attachments/{id}/email). */
export interface AttachmentEmail {
  subject: string;
  from: string;
  to: string;
  date: string;
  html: string;
  text: string;
  /** Имена вложений письма */
  attachments: string[];
}

/** Загрузка файла частями (POST /attachments/uploads). */
export interface UploadSession {
  /** upload_id — вместо content при создании вложения */
  id: number;
  part_size: number;
  offset: number;
}

const attachmentsApi = crudApi.injectEndpoints({
  endpoints: build => ({
    getAttachmentEmail: build.query<AttachmentEmail, number>({
      query: id => ({ method: 'GET', url: `attachments/${id}/email` }),
    }),
    startUpload: build.mutation<
      UploadSession,
      { name: string; mimetype?: string; size: number }
    >({
      query: body => ({ method: 'POST', url: 'attachments/uploads', body }),
    }),
    // 409 {offset} — сервер ждёт часть с другой позиции
    uploadPart: build.mutation<
      { offset: number },
      { id: number; offset: number; part: Blob }
    >({
      query: ({ id, offset, part }) => ({
        method: 'PATCH',
        url: `attachments/uploads/${id}`,
        body: part,
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset),
        },
      }),
    }),
    // Мутации, а не query: ответ нужен один раз, кэшировать нечего
    getUploadOffset: build.mutation<{ offset: number; size: number }, number>({
      query: id => ({ method: 'GET', url: `attachments/uploads/${id}` }),
    }),
    abortUpload: build.mutation<unknown, number>({
      query: id => ({ method: 'DELETE', url: `attachments/uploads/${id}` }),
    }),
  }),
});

export const {
  useGetAttachmentEmailQuery,
  useStartUploadMutation,
  useUploadPartMutation,
  useGetUploadOffsetMutation,
  useAbortUploadMutation,
} = attachmentsApi;
