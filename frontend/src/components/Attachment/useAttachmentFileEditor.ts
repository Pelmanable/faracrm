/**
 * Общее у встроенных редакторов вложений (docx, xlsx): байты файла при
 * открытии окна, сохранение обратно обычным PUT /auto/attachments/{id} с
 * base64-контентом — тот же путь, что у замены файла в форме вложения
 * (Attachment.update пишет байты в хранилище), — и вопрос перед закрытием
 * с несохранённым.
 */
import { useCallback, useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useUpdateMutation } from '@/services/api/crudApi';
import { attachmentContentUrl } from '@/utils/attachmentUrls';
import { arrayBufferToBase64 } from '@/utils/base64';

interface AttachmentFileEditorOptions {
  attachmentId: number;
  opened: boolean;
  onClose: () => void;
  /** После успешного сохранения — новый размер файла в байтах. */
  onSaved?: (size: number) => void;
}

export function useAttachmentFileEditor({
  attachmentId,
  opened,
  onClose,
  onSaved,
}: AttachmentFileEditorOptions) {
  const { t } = useTranslation('common');
  const [bytes, setBytes] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [update] = useUpdateMutation();

  // Загрузка файла при открытии; при закрытии — сброс, чтобы следующее
  // открытие показало актуальные байты, а не старую копию.
  useEffect(() => {
    if (!opened) {
      setBytes(null);
      setLoadError(null);
      setDirty(false);
      return;
    }
    let cancelled = false;
    // no-store: у ответа есть Last-Modified без Cache-Control, и браузер
    // вправе отдать из кэша копию до прошлого сохранения
    fetch(attachmentContentUrl(attachmentId), {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(buffer => {
        if (!cancelled) setBytes(new Uint8Array(buffer));
      })
      .catch(error => {
        if (!cancelled) setLoadError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [opened, attachmentId]);

  /**
   * Собрать файл в редакторе и записать во вложение. Сборка — внутри try:
   * её ошибка тоже должна дойти до пользователя, а не потеряться.
   */
  const save = useCallback(
    async (getBuffer: () => Promise<ArrayBuffer | null> | undefined) => {
      setSaving(true);
      try {
        const buffer = await getBuffer();
        if (!buffer) return;
        const content = await arrayBufferToBase64(buffer);
        await update({
          model: 'attachments',
          id: attachmentId,
          values: { content, size: buffer.byteLength },
        }).unwrap();
        setDirty(false);
        notifications.show({ message: t('docxEditor.saved'), color: 'green' });
        onSaved?.(buffer.byteLength);
      } catch (error) {
        notifications.show({
          title: t('docxEditor.saveFailed'),
          message: String(error),
          color: 'red',
        });
      } finally {
        setSaving(false);
      }
    },
    [attachmentId, onSaved, t, update],
  );

  const markDirty = useCallback(() => setDirty(true), []);

  const handleClose = useCallback(() => {
    if (dirty && !window.confirm(t('docxEditor.unsavedClose'))) return;
    onClose();
  }, [dirty, onClose, t]);

  return { bytes, loadError, dirty, markDirty, saving, save, handleClose };
}
