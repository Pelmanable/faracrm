/**
 * Просмотр вложения без скачивания — одна точка для всех «Просмотр»
 * (issue #62): что показывает окно просмотра — в нём (со стрелками по
 * соседним файлам), PDF и документы — во вкладке браузера, docx и xlsx —
 * во встроенном редакторе. По какому признаку — getViewKind.
 *
 * Использование:
 *   const attachmentViewer = useAttachmentViewer();
 *   <ActionIcon onClick={() => attachmentViewer.open(file, files)} />
 *   {attachmentViewer.modal}
 */
import { useCallback, useState } from 'react';
import { AttachmentEditorModal } from './AttachmentEditorModal';
import { AttachmentViewerModal } from './viewer/AttachmentViewerModal';
import { getViewKind, isWindowViewKind } from './viewKind';
import {
  openAttachmentAsPdf,
  openAttachmentInBrowser,
} from '@/utils/attachmentUrls';

export interface ViewableAttachment {
  id?: number;
  name?: string | null;
  mimetype?: string | null;
  checksum?: string | null;
  /** Ещё не сохранённый файл — из памяти браузера (поле ввода чата, форма) */
  file?: Blob | null;
}

/** Есть ли у файла просмотр без скачивания. */
export function canViewAttachment(attachment: {
  mimetype?: string | null;
  name?: string | null;
}): boolean {
  return getViewKind(attachment) !== null;
}

export function useAttachmentViewer() {
  const [gallery, setGallery] = useState<{
    items: ViewableAttachment[];
    index: number;
  } | null>(null);
  const [editing, setEditing] = useState<ViewableAttachment | null>(null);

  /** items — соседние файлы (сообщения, списка) для стрелок окна. */
  const open = useCallback(
    (
      attachment: ViewableAttachment,
      items: ViewableAttachment[] = [attachment],
    ) => {
      const kind = getViewKind(attachment);
      if (kind === 'pdf') {
        openAttachmentInBrowser(attachment.id!, attachment.checksum);
        return;
      }
      if (kind === 'office') {
        openAttachmentAsPdf(attachment.id!, attachment.checksum);
        return;
      }
      if (kind === 'editor') {
        setEditing(attachment);
        return;
      }
      if (!isWindowViewKind(kind)) return;

      const windowItems = items.filter(item =>
        isWindowViewKind(getViewKind(item)),
      );
      const index = windowItems.findIndex(
        item => item === attachment || (!!item.id && item.id === attachment.id),
      );
      setGallery(
        index >= 0
          ? { items: windowItems, index }
          : { items: [attachment], index: 0 },
      );
    },
    [],
  );

  let modal = null;
  if (gallery) {
    modal = (
      <AttachmentViewerModal
        items={gallery.items}
        initialIndex={gallery.index}
        onClose={() => setGallery(null)}
      />
    );
  } else if (editing) {
    modal = (
      <AttachmentEditorModal
        opened
        attachmentId={editing.id!}
        filename={editing.name}
        mimetype={editing.mimetype}
        onClose={() => setEditing(null)}
      />
    );
  }

  return { open, modal };
}
