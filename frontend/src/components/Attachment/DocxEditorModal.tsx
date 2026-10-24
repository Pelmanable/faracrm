/**
 * Полноэкранный редактор docx-вложения.
 *
 * Правит во встроенном редакторе (DocxEditorFrame, ленивый чанк); загрузка
 * и сохранение обратно во вложение — useAttachmentFileEditor.
 *
 * Использование:
 *   <DocxEditorModal attachmentId={id} filename={name} opened onClose={...} />
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
import type { DocxEditorFrameHandle } from './DocxEditorFrame';

const DocxEditorFrame = lazy(() =>
  import('./DocxEditorFrame').then(m => ({ default: m.DocxEditorFrame })),
);

interface DocxEditorModalProps {
  attachmentId: number;
  filename?: string | null;
  opened: boolean;
  onClose: () => void;
  /** После успешного сохранения — новый размер файла в байтах. */
  onSaved?: (size: number) => void;
}

export function DocxEditorModal({
  attachmentId,
  filename,
  opened,
  onClose,
  onSaved,
}: DocxEditorModalProps) {
  const { t } = useTranslation('common');
  const frameRef = useRef<DocxEditorFrameHandle>(null);
  const { bytes, loadError, dirty, markDirty, saving, save, handleClose } =
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

  const actions = (
    <Group gap="xs" wrap="nowrap">
      <Button size="xs" onClick={handleSave} loading={saving} disabled={!bytes}>
        {t('save')}
      </Button>
      <Button size="xs" variant="default" onClick={handleClose}>
        {t('close')}
      </Button>
    </Group>
  );

  const fallback = (
    <Center style={{ flex: 1 }}>
      <Loader />
    </Center>
  );

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      fullScreen
      padding={0}
      withCloseButton={false}
      closeOnEscape={!dirty}
      styles={{
        content: { display: 'flex', flexDirection: 'column' },
        body: {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }}>
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
          <DocxEditorFrame
            ref={frameRef}
            document={bytes}
            title={filename || undefined}
            onSave={handleSave}
            onChange={markDirty}
            titleBarRight={actions}
          />
        </Suspense>
      ) : (
        fallback
      )}
    </Modal>
  );
}
