/**
 * API конструктора шаблонов отчётов (модуль report_docx_design):
 *  - каталог полей шаблона GET /reports/templates/{id}/fields;
 *  - превью POST /reports/preview — рендер несохранённого DOCX из редактора
 *    с данными записи (бэк — ReportTemplate.render_bytes).
 */
import { crudApi } from '@/services/api/crudApi';
import { API_BASE_URL } from '@/services/baseQueryWithReauth';
import { filenameFromDisposition } from '@/utils/attachmentUrls';

/** Узел каталога: поле записи или ключ функции данных (см. catalog.py). */
export interface ReportFieldNode {
  key: string;
  label: string;
  /** text | money | date | datetime | relation | list */
  type: string;
  /** field — поле записи модели, function — объявлено @report_fields */
  kind: 'field' | 'function';
  /** Готовый тег подстановки, у списков отсутствует */
  tag?: string;
  loop_start?: string;
  loop_end?: string;
  children?: ReportFieldNode[];
}

const designApi = crudApi.injectEndpoints({
  endpoints: build => ({
    templateFields: build.query<{ data: ReportFieldNode[] }, number>({
      query: templateId => ({ url: `/reports/templates/${templateId}/fields` }),
    }),
  }),
});

export const { useTemplateFieldsQuery } = designApi;

export interface PreviewArgs {
  templateId: number;
  /** DOCX из редактора */
  document: ArrayBuffer;
  params: Record<string, unknown>;
  outputFormat: 'docx' | 'pdf';
}

export interface PreviewFile {
  blob: Blob;
  /** Имя файла из Content-Disposition (как при скачивании отчёта) */
  filename: string;
}

/**
 * Рендер превью; бинарный ответ, поэтому fetch, а не RTK Query. Тело —
 * сам DOCX (разовый рендер, не сохранение файла), параметры — в строке
 * запроса.
 */
export async function fetchReportPreview(
  token: string,
  args: PreviewArgs,
): Promise<PreviewFile> {
  const query = new URLSearchParams({
    template_id: String(args.templateId),
    output_format: args.outputFormat,
    params: JSON.stringify(args.params),
  });
  const response = await fetch(`${API_BASE_URL}/reports/preview?${query}`, {
    method: 'POST',
    // verify_access требует и Bearer, и HttpOnly-куку (Token Binding):
    // без credentials кука на другой порт не уйдёт → #UNAUTHORIZED
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: args.document,
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data?.error) message = String(data.error);
    } catch {
      // ответ не JSON — оставляем код статуса
    }
    throw new Error(message);
  }
  return {
    blob: await response.blob(),
    filename:
      filenameFromDisposition(response.headers.get('Content-Disposition')) ||
      `report_${args.templateId}.${args.outputFormat}`,
  };
}
