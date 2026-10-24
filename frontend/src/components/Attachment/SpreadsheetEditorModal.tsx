/**
 * Полноэкранный редактор xlsx-вложения.
 *
 * Правит в FortuneSheet (SpreadsheetEditorFrame, ленивый чанк); загрузка и
 * сохранение обратно во вложение — useAttachmentFileEditor, как у docx.
 */
import { lazy, Suspense, useCallback, useRef } from 'react';
import {
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useAttachmentFileEditor } from './useAttachmentFileEditor';
import type { SpreadsheetEditorFrameHandle } from './SpreadsheetEditorFrame';

const SpreadsheetEditorFrame = lazy(() =>
  import('./SpreadsheetEditorFrame').then(m => ({
    default: m.SpreadsheetEditorFrame,
  })),
);

interface SpreadsheetEditorModalProps {
  attachmentId: number;
  filename?: string | null;
  opened: boolean;
  onClose: () => void;
  /** После успешного сохранения — новый размер файла в байтах. */
  onSaved?: (size: number) => void;
}

export function SpreadsheetEditorModal({
  attachmentId,
  filename,
  opened,
  onClose,
  onSaved,
}: SpreadsheetEditorModalProps) {
  const { t } = useTranslation('common');
  const frameRef = useRef<SpreadsheetEditorFrameHandle>(null);
  const { bytes, loadError, markDirty, saving, save, handleClose } =
    useAttachmentFileEditor({
      attachmentId,
      filename,
      opened,
      onClose,
      onSaved,
    });

  const handleSave = useCallback(
    () => save(() => frameRef.current?.save()),
    [save],
  );

  const fallback = (
    <Center style={{ flex: 1 }}>
      <Loader />
    </Center>
  );

  // Escape и Tab — клавиши таблицы (отмена правки ячейки, следующая
  // ячейка), а не окна
  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      fullScreen
      padding={0}
      withCloseButton={false}
      closeOnEscape={false}
      trapFocus={false}
      styles={{
        content: { display: 'flex', flexDirection: 'column' },
        body: {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }}>
      <Group justify="space-between" wrap="nowrap" px="md" py="xs">
        <Text fw={500} truncate>
          {filename}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="xs"
            onClick={handleSave}
            loading={saving}
            disabled={!bytes}>
            {t('save')}
          </Button>
          <Button size="xs" variant="default" onClick={handleClose}>
            {t('close')}
          </Button>
        </Group>
      </Group>

      {loadError ? (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap="sm">
            <Text c="red">
              {t('docxEditor.loadFailed')}: {loadError}
            </Text>
            <Button variant="default" onClick={onClose}>
              {t('close')}
            </Button>
          </Stack>
        </Center>
      ) : bytes ? (
        <Suspense fallback={fallback}>
          <SpreadsheetEditorFrame
            ref={frameRef}
            document={bytes}
            fileName={filename || 'table.xlsx'}
            onChange={markDirty}
          />
        </Suspense>
      ) : (
        fallback
      )}
    </Modal>
  );
}
