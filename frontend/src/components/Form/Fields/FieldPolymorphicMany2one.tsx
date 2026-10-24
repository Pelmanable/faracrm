import { useRef, useState, useEffect, DragEvent, ChangeEvent } from 'react';
import { Box, Text, Group, Stack, useMantineTheme } from '@mantine/core';
import { IconUpload, IconFile } from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { useFormContext } from '../FormContext';
import {
  AttachmentPreview,
  UploadProgress,
  formatFileSize,
} from '@/components/Attachment';
import classes from './FieldPolymorphicMany2one.module.css';
import { downloadAttachment, downloadBlob } from '@/utils/attachmentUrls';
import { fileMimetype, useFileUploads } from '@/hooks/useFileUploads';
import { useTranslation } from 'react-i18next';

interface FieldPolymorphicMany2oneProps {
  name: string;
  model?: string;
  label?: string;
  accept?: string;
  maxSize?: number; // в байтах
}

export const FieldPolymorphicMany2one = ({
  name,
  model,
  label,
  accept,
  maxSize = 1024 * 1024 * 1024, // как attachments.max_upload_size
}: FieldPolymorphicMany2oneProps) => {
  const form = useFormContext();
  const { t } = useTranslation('common');
  const { id } = useParams<{ id: string }>();
  const theme = useMantineTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  // Новый файл грузится на сервер частями сразу при выборе; в значение
  // поля — его upload_id, превью — из памяти браузера
  const uploads = useFileUploads();
  const newFile = uploads.files.file ?? null;
  const progress = uploads.progress.file ?? null;
  const isUploading = progress !== null;
  // Значение поля до нового файла — вернуть, если загрузка не удалась
  const beforeUploadRef = useRef<unknown>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Текущее значение из формы
  const currentValue = form.getValues()?.[name];
  const hasExistingFile =
    currentValue?.id && typeof currentValue.id === 'number';
  const hasNewFile = !!currentValue?.upload_id;
  const hasFile = hasExistingFile || hasNewFile;

  // Запрос на скачивание файла
  const [shouldFetch, setShouldFetch] = useState(false);

  useEffect(() => {
    if (shouldFetch) {
      handleDownload();
      setShouldFetch(false);
    }
  }, [shouldFetch]);

  // Обработка файла
  const processFile = async (file: File) => {
    setError(null);

    // Проверка размера
    if (file.size > maxSize) {
      setError(`Файл слишком большой. Максимум: ${formatFileSize(maxSize)}`);
      return;
    }

    if (!hasNewFile) beforeUploadRef.current = currentValue ?? null;
    try {
      // В форму сразу: «Сохранить» до конца загрузки сервер отклонит
      // (загрузка не завершена), а не сохранит запись без файла
      await uploads.start('file', file, uploadId =>
        form.setValues({
          [name]: {
            name: file.name,
            mimetype: fileMimetype(file),
            size: file.size,
            res_model: model,
            res_id: id ? Number(id) : null,
            upload_id: uploadId,
          },
        }),
      );
    } catch (err) {
      console.error('Ошибка загрузки файла:', err);
      setError('Ошибка загрузки файла');
      form.setValues({ [name]: beforeUploadRef.current });
    }
  };

  // Обработка выбора файла через input
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
    // Сбрасываем input для возможности повторной загрузки того же файла
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  // Drag & Drop handlers
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  // Клик по зоне загрузки
  const handleZoneClick = () => {
    inputRef.current?.click();
  };

  // Удаление файла
  const handleDelete = () => {
    uploads.forget('file');
    form.setValues({ [name]: null });
    setError(null);
  };

  // Замена файла
  const handleReplace = () => {
    inputRef.current?.click();
  };

  // Скачивание файла
  const handleDownload = () => {
    if (hasNewFile && newFile) {
      downloadBlob(newFile, currentValue.name);
    } else if (hasExistingFile) {
      downloadAttachment(currentValue.id, currentValue.name);
    }
  };

  return (
    <Stack gap="xs">
      {label && (
        <Text size="sm" fw={500}>
          {label || name}
        </Text>
      )}

      {/* Скрытый input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />

      {/* Отображение загруженного файла */}
      {hasFile && !isUploading && (
        <AttachmentPreview
          attachment={{
            id: currentValue.id,
            name: currentValue.name,
            mimetype: currentValue.mimetype,
            size: currentValue.size,
            file: hasNewFile ? newFile : undefined,
          }}
          onDelete={handleDelete}
          onReplace={handleReplace}
          onDownload={handleDownload}
          showPreview={currentValue.show_preview !== false}
          showActions={true}
        />
      )}

      {/* Зона загрузки */}
      {(!hasFile || isUploading) && (
        <Box
          className={classes.dropzone}
          data-drag-over={isDragOver || undefined}
          data-loading={isUploading || undefined}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleZoneClick}>
          <Group justify="center" gap="xl" mih={120}>
            {isDragOver ? (
              <IconUpload size={50} stroke={1.5} color={theme.colors.blue[6]} />
            ) : (
              <IconFile size={50} stroke={1.5} color={theme.colors.gray[5]} />
            )}

            <Stack align="center" ta="center" gap={4}>
              {isUploading ? (
                <UploadProgress value={progress} />
              ) : (
                <div>
                  <Text size="sm" inline>
                    {t('dropzone.dropFile')}
                  </Text>
                  <Text size="xs" c="dimmed" inline mt={7}>
                    {t('dropzone.maxSize', { size: formatFileSize(maxSize) })}
                  </Text>
                </div>
              )}
            </Stack>
          </Group>
        </Box>
      )}

      {/* Ошибка */}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
};
