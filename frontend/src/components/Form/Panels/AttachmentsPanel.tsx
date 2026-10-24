import { useRef, useState } from 'react';
import { Stack, Text, Button, Loader } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import {
  useSearchQuery,
  useCreateMutation,
  useDeleteBulkMutation,
} from '@/services/api/crudApi';
import {
  AttachmentPreview,
  canViewAttachment,
  useAttachmentViewer,
} from '@/components/Attachment';
import type { ViewableAttachment } from '@/components/Attachment';
import { UploadProgress } from '@/components/Attachment/UploadProgress';
import { useUploadFile } from '@/hooks/useUploadFile';
import { fileMimetype } from '@/hooks/useFileUploads';
import { downloadAttachment } from '@/utils/attachmentUrls';

const PAGE_SIZE = 80;

interface AttachmentsPanelProps {
  resModel: string;
  resId: number;
}

export function AttachmentsPanel({ resModel, resId }: AttachmentsPanelProps) {
  const { t } = useTranslation(['common']);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [limit, setLimit] = useState(PAGE_SIZE);
  const attachmentViewer = useAttachmentViewer();

  const { data: attachmentsData, isLoading } = useSearchQuery({
    model: 'attachments',
    fields: [
      'id',
      'name',
      'size',
      'mimetype',
      'checksum',
      'storage_file_url',
      'storage_file_id',
      'is_voice',
      'show_preview',
    ],
    filter: [
      ['res_model', '=', resModel],
      ['res_id', '=', resId],
      ['folder', '=', false],
    ],
    sort: 'id',
    order: 'desc',
    limit,
  });

  const [createAttachment, { isLoading: isCreating }] = useCreateMutation();
  const [deleteAttachment] = useDeleteBulkMutation();
  const uploadFile = useUploadFile();
  // Процент загрузки текущего файла; null — не грузится
  const [progress, setProgress] = useState<number | null>(null);

  const attachments = attachmentsData?.data || [];
  const total = attachmentsData?.total || 0;
  const hasMore = total > attachments.length;

  // Файлы записи — для стрелок окна просмотра
  const viewItems: ViewableAttachment[] = attachments.map((att: any) => ({
    id: att.id,
    name: att.name,
    mimetype: att.mimetype,
    checksum: att.checksum,
  }));

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Файл частями на сервер, затем вложение записи с его upload_id
    for (const file of Array.from(files)) {
      const mimetype = fileMimetype(file);
      setProgress(0);
      try {
        const uploadId = await uploadFile(file, {
          name: file.name,
          mimetype,
          onProgress: (loaded, total) => setProgress((loaded / total) * 100),
        });
        await createAttachment({
          model: 'attachments',
          values: {
            name: file.name,
            res_model: resModel,
            res_id: resId,
            mimetype,
            size: file.size,
            upload_id: uploadId,
            folder: false,
            public: false,
          },
        }).unwrap();
      } catch (error) {
        console.error('Failed to upload attachment:', error);
      }
    }
    setProgress(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAttachment({
        model: 'attachments',
        ids: [id],
      }).unwrap();
    } catch (error) {
      console.error('Failed to delete attachment:', error);
    }
  };

  const handleDownload = (id: number) => {
    const name = attachments.find((att: any) => att.id === id)?.name;
    downloadAttachment(id, name);
  };

  const handleLoadMore = () => {
    setLimit(prev => prev + PAGE_SIZE);
  };

  if (isLoading && attachments.length === 0) {
    return (
      <Stack align="center" py="xl">
        <Loader size="sm" />
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      {/* Upload button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={e => handleUpload(e.target.files)}
      />
      <Button
        variant="light"
        size="compact-sm"
        leftSection={<IconUpload size={14} />}
        onClick={() => fileInputRef.current?.click()}
        loading={progress !== null || isCreating}
        fullWidth>
        {t('common:upload', 'Загрузить файл')}
      </Button>
      {progress !== null && <UploadProgress value={progress} />}

      {/* Attachment list with AttachmentPreview */}
      {attachments.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          {t('common:noAttachments', 'Нет вложений')}
        </Text>
      )}

      {attachments.map((att: any, index: number) => (
        <AttachmentPreview
          key={att.id}
          attachment={{
            id: att.id,
            name: att.name,
            mimetype: att.mimetype,
            size: att.size,
            storage_file_url: att.storage_file_url,
            is_voice: att.is_voice,
          }}
          onDelete={() => handleDelete(att.id)}
          onDownload={() => handleDownload(att.id)}
          onClick={
            canViewAttachment(att)
              ? () => attachmentViewer.open(viewItems[index], viewItems)
              : undefined
          }
          showPreview={att.show_preview !== false}
          previewSize={80}
        />
      ))}

      {hasMore && (
        <Button
          variant="subtle"
          size="compact-sm"
          onClick={handleLoadMore}
          loading={isLoading}
          fullWidth>
          {t('common:loadMore', 'Загрузить ещё')} ({total - attachments.length})
        </Button>
      )}

      {/* Окно просмотра со стрелками по файлам записи */}
      {attachmentViewer.modal}
    </Stack>
  );
}
