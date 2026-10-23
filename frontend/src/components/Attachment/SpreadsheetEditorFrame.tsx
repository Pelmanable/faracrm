/**
 * Каркас встроенного редактора XLSX (FortuneSheet + fortune-excel) —
 * отдельный ленивый чанк (~4 МБ): импортируется, только когда пользователь
 * открыл таблицу (SpreadsheetEditorModal).
 *
 * Сохранение собирает .xlsx заново из модели FortuneSheet: чего она не
 * понимает (диаграммы, сводные таблицы, макросы, часть форматов), в
 * сохранённом файле не останется.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { Center, Loader, Text } from '@mantine/core';
import { Workbook, type WorkbookInstance } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import {
  transformExcelToFortune,
  transformFortuneToExcel,
} from '@corbe30/fortune-excel';

type Sheet = ComponentProps<typeof Workbook>['data'][number];

/**
 * Листы для экспорта. Импорт fortune-excel помечает текст с оформлением
 * как inlineStr без фрагментов s, а экспорт того же пакета на таких
 * ячейках падает (ct.s.forEach) — отдаём их обычным текстом.
 */
function exportableSheets(sheets: Sheet[]): Sheet[] {
  return sheets.map(sheet => ({
    ...sheet,
    data: sheet.data?.map(row =>
      row.map(cell =>
        cell?.ct?.t === 'inlineStr' && !cell.ct.s
          ? { ...cell, ct: { ...cell.ct, t: 'g' } }
          : cell,
      ),
    ),
  }));
}

/**
 * Зафиксировать ввод в ячейку, как Enter. FortuneSheet фиксирует его только
 * по Enter, Tab или клику по другой ячейке — клик по «Сохранить» вне книги
 * ввод не фиксирует, и экспорт взял бы старое значение. Поле ввода поднято
 * над листом (z-index 19), только пока ячейка редактируется: иначе Enter,
 * наоборот, открыл бы ячейку на ввод.
 */
async function commitCellEdit(container: HTMLElement | null) {
  const box = container?.querySelector<HTMLElement>('.luckysheet-input-box');
  if (box?.style.zIndex !== '19') return;
  box
    .querySelector('.luckysheet-cell-input')
    ?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  // Книга перерисуется с зафиксированным значением — после этого экспорт
  await new Promise(resolve => setTimeout(resolve));
}

export interface SpreadsheetEditorFrameHandle {
  /** Текущая книга как xlsx-байты. */
  save(): Promise<ArrayBuffer>;
}

interface SpreadsheetEditorFrameProps {
  document: Uint8Array<ArrayBuffer>;
  fileName: string;
  /** Правка пользователя — для флага «есть несохранённое». */
  onChange?: () => void;
}

export const SpreadsheetEditorFrame = forwardRef<
  SpreadsheetEditorFrameHandle,
  SpreadsheetEditorFrameProps
>(function SpreadsheetEditorFrame({ document, fileName, onChange }, ref) {
  const sheetRef = useRef<WorkbookInstance>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // fortune-excel кладёт листы через setSheets и пересоздаёт книгу через key
  const [key, setKey] = useState(0);
  const [sheets, setSheets] = useState<Sheet[]>([{ name: 'Sheet1' }]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Разбор, который уже не нужен (StrictMode в dev запускает эффект
  // дважды), книгу не трогает: иначе его отложенная установка ширин
  // колонок ищет по id листы чужого разбора и роняет книгу «sheet not found»
  useEffect(() => {
    let cancelled = false;
    const ifActive =
      <T,>(set: (value: T) => void) =>
      (value: T) => {
        if (!cancelled) set(value);
      };
    const activeRef = {
      get current() {
        return cancelled ? null : sheetRef.current;
      },
    };

    transformExcelToFortune(
      new File([document], fileName),
      ifActive(setSheets),
      ifActive(setKey),
      activeRef,
    )
      .then(() => ifActive(setLoaded)(true))
      .catch(e => ifActive(setError)(String(e)));
    return () => {
      cancelled = true;
    };
  }, [document, fileName]);

  // Экспорт читает книгу через ref.current.getAllSheets() — подсовываем
  // листы после exportableSheets. Формат по умолчанию — xlsx (enum
  // IFileType пакет наружу не отдаёт); false — вернуть Blob, не скачивать
  useImperativeHandle(
    ref,
    () => ({
      save: async () => {
        await commitCellEdit(containerRef.current);
        const exportRef = {
          current: {
            getAllSheets: () =>
              exportableSheets(sheetRef.current!.getAllSheets()),
          },
        };
        const blob = await transformFortuneToExcel(exportRef, undefined, false);
        return blob.arrayBuffer();
      },
    }),
    [],
  );

  if (error) {
    return (
      <Center style={{ flex: 1 }}>
        <Text c="red">Не удалось открыть таблицу: {error}</Text>
      </Center>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <Workbook
        key={key}
        ref={sheetRef}
        data={sheets}
        lang="ru"
        // onOp книга зовёт во время своей отрисовки: флаг «изменено» в окне
        // ставим после неё, иначе React ругается на setState в чужом render
        onOp={() => queueMicrotask(() => onChange?.())}
      />
      {/* Пока файл разбирается, под этим — пустой лист-заглушка */}
      {!loaded && (
        <Center
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'var(--mantine-color-body)',
          }}>
          <Loader />
        </Center>
      )}
    </div>
  );
});
