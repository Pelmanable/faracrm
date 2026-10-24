/**
 * API модуля Excel: экспорт выборки списка в .xlsx и импорт записей из
 * .xlsx. Формат технический: заголовки — имена полей, связи — id.
 * Бэк — backend/base/system/excel/routers/excel.py.
 */
import { useSelector } from 'react-redux';
import { crudApi } from '@/services/api/crudApi';
import { API_BASE_URL } from '@/services/baseQueryWithReauth';
import type {
  FilterExpression,
  SelectionOption,
} from '@/services/api/crudTypes';
import { selectCurrentSession } from '@/slices/authSlice';
import { triggerDownload } from '@/utils/attachmentUrls';

/** Выборка списка, которую выгружает экспорт (как ушла в /search). */
export interface ExcelQuery {
  filter?: FilterExpression;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface ExcelExportBody extends ExcelQuery {
  /** Имена полей — заголовки и порядок колонок файла. */
  fields: string[];
  /** Выбранные записи — вместо фильтра. */
  ids?: number[];
}

export interface ExcelPreviewColumn {
  index: number;
  header: string;
  /** Поле модели по заголовку (без режима «(name)») — автосопоставление. */
  field: string | null;
  samples: string[];
}

/** Поле модели, которое можно заполнить из файла (get_fields_info_list). */
export interface ExcelImportField {
  name: string;
  type: string;
  required?: boolean;
  relation?: string;
  options?: SelectionOption[];
}

export interface ExcelPreview {
  columns: ExcelPreviewColumn[];
  rows_total: number;
  fields: ExcelImportField[];
}

export interface ExcelImportError {
  /** Номер строки в файле (первая — заголовки). */
  row: number;
  field?: string;
  message: string;
}

export interface ExcelImportResult {
  created: number;
  errors: ExcelImportError[];
}

// Файл — загрузкой частями (useUploadFile): разбор и импорт читают его по
// одному upload_id
const excelApi = crudApi.injectEndpoints({
  endpoints: build => ({
    excelPreview: build.mutation<
      ExcelPreview,
      { model: string; upload_id: number }
    >({
      query: ({ model, upload_id }) => ({
        url: `/excel/${model}/preview`,
        method: 'POST',
        body: { upload_id },
      }),
    }),
    excelImport: build.mutation<
      ExcelImportResult,
      { model: string; upload_id: number; mapping: Record<number, string> }
    >({
      query: ({ model, upload_id, mapping }) => ({
        url: `/excel/${model}/import`,
        method: 'POST',
        body: { upload_id, mapping },
      }),
      // Появились записи — список модели перечитать.
      invalidatesTags: (_result, _error, { model }) => [
        { type: model, id: 'LIST' },
      ],
    }),
  }),
});

export const { useExcelPreviewMutation, useExcelImportMutation } = excelApi;

/**
 * Скачать экспорт. Ответ — файл, поэтому обычный fetch с токеном сессии
 * (как печать отчётов), а не RTK Query: blob в сторе не нужен.
 */
export function useExcelExport() {
  const session = useSelector(selectCurrentSession);
  return async (model: string, body: ExcelExportBody): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/excel/${model}/export`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(
        data?.detail || data?.content || `HTTP ${response.status}`,
      );
    }
    const url = URL.createObjectURL(await response.blob());
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(url, `${model}_${date}.xlsx`);
    URL.revokeObjectURL(url);
  };
}
