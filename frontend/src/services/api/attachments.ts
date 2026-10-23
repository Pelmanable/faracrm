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

const attachmentsApi = crudApi.injectEndpoints({
  endpoints: build => ({
    getAttachmentEmail: build.query<AttachmentEmail, number>({
      query: id => ({ method: 'GET', url: `attachments/${id}/email` }),
    }),
  }),
});

export const { useGetAttachmentEmailQuery } = attachmentsApi;
