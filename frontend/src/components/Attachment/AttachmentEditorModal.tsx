/**
 * Встроенный редактор вложения по типу файла: xlsx — SpreadsheetEditorModal,
 * docx — DocxEditorModal. Есть ли редактор — canEditAttachment (viewKind).
 */
import { DocxEditorModal } from './DocxEditorModal';
import { SpreadsheetEditorModal } from './SpreadsheetEditorModal';
import { isXlsxMimetype } from './fileIcons';

interface AttachmentEditorModalProps {
  attachmentId: number;
  filename?: string | null;
  mimetype?: string | null;
  opened: boolean;
  onClose: () => void;
}

export function AttachmentEditorModal({
  mimetype,
  ...props
}: AttachmentEditorModalProps) {
  return isXlsxMimetype(mimetype, props.filename) ? (
    <SpreadsheetEditorModal {...props} />
  ) : (
    <DocxEditorModal {...props} />
  );
}
