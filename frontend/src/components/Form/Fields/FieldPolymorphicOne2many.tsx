import { useRef, useState, useContext, DragEvent, ChangeEvent } from 'react';
import {
  Box,
  Text,
  Group,
  Stack,
  SimpleGrid,
  useMantineTheme,
} from '@mantine/core';
import { IconUpload, IconFile, IconPlus } from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { FormFieldsContext, useFormContext } from '../FormContext';
import {
  AttachmentPreview,
  isImageMimetype,
  formatFileSize,
  useAttachmentViewer,
} from '@/components/Attachment';
import classes from './FieldPolymorphicOne2many.module.css';
import { downloadAttachment, downloadBlob } from '@/utils/attachmentUrls';
import { fileMimetype, useFileUploads } from '@/hooks/useFileUploads';
import { useTranslation } from 'react-i18next';

interface AttachmentFile {
  id?: number;
  name: string;
  mimetype: string;
  size: number;
  upload_id?: number; // новый файл, загруженный частями
  res_model?: string;
  res_id?: number | null;
  _isNew?: boolean; // маркер нового файла
  _localId?: string; // локальный id для ключей
}

interface FieldPolymorphicOne2manyProps {
  name: string;
  model?: string;
  label?: string;
  accept?: string;
  maxSize?: number; // максимальный размер одного файла в байтах
  maxFiles?: number; // максимальное количество файлов
  showPreview?: boolean; // загружать ли превью изображений (по умолчанию true)
  previewSize?: number;
  columns?: number; // количество колонок в сетке
}

export const FieldPolymorphicOne2many = ({
  name,
  model,
  label,
  accept,
  maxSize = 1024 * 1024 * 1024, // как attachments.max_upload_size
  maxFiles = 50,
  showPreview = true,
  previewSize = 100,
  columns = 4,
}: FieldPolymorphicOne2manyProps) => {
  const form = useFormContext();
  const { t } = useTranslation('common');
  const { id } = useParams<{ id: string }>();
  const theme = useMantineTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const { fields: fieldsServer } = useContext(FormFieldsContext);

  // Новые файлы грузятся на сервер частями сразу при выборе; в created —
  // их upload_id. Сами файлы (превью, скачать) и проценты загрузки — по
  // _localId строки
  const uploads = useFileUploads();
  const isUploading = Object.keys(uploads.progress).length > 0;
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachmentViewer = useAttachmentViewer();

  // Получить все файлы (существующие + новые)
  const getExistingFiles = (): AttachmentFile[] => {
    const fieldValue = form.getValues()?.[name];
    if (fieldValue?.data && Array.isArray(fieldValue.data)) {
      return fieldValue.data.map((f: any) => ({ ...f, _isNew: false }));
    }
    return [];
  };

  const getNewFiles = (): AttachmentFile[] => {
    const fieldValue = form.getValues()?.['_' + name];
    if (fieldValue?.created && Array.isArray(fieldValue.created)) {
      return fieldValue.created.map((f: any) => ({ ...f, _isNew: true }));
    }
    return [];
  };

  const getDeletedIds = (): number[] => {
    const fieldValue = form.getValues()?.['_' + name];
    if (fieldValue?.deleted && Array.isArray(fieldValue.deleted)) {
      return fieldValue.deleted;
    }
    return [];
  };

  const existingFiles = getExistingFiles();
  const newFiles = getNewFiles();
  const deletedIds = getDeletedIds();

  // Фильтруем удалённые из существующих
  const visibleExistingFiles = existingFiles.filter(
    f => f.id && !deletedIds.includes(f.id),
  );
  const allFiles = [...visibleExistingFiles, ...newFiles];

  // Новые файлы поля (created) — значения читаются из формы в момент
  // вызова: загрузки завершаются в разное время
  const setCreated = (created: AttachmentFile[]) =>
    form.setValues({
      ['_' + name]: {
        deleted: getDeletedIds(),
        created,
        fieldsServer: fieldsServer,
      },
    });

  const uploadNewFile = async (file: File) => {
    const localId = `new_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    try {
      // Строка в created сразу: «Сохранить» до конца загрузки сервер
      // отклонит (загрузка не завершена), а не сохранит без файла
      await uploads.start(localId, file, uploadId =>
        setCreated([
          ...getNewFiles(),
          {
            name: file.name,
            mimetype: fileMimetype(file),
            size: file.size,
            res_model: model,
            res_id: id ? Number(id) : null,
            upload_id: uploadId,
            _isNew: true,
            _localId: localId,
          },
        ]),
      );
    } catch (err) {
      console.error('Ошибка загрузки файла:', err);
      setError('Ошибка загрузки файлов');
      setCreated(getNewFiles().filter(f => f._localId !== localId));
    }
  };

  // Обработка файлов
  const processFiles = (files: FileList | File[]) => {
    setError(null);
    const fileArray = Array.from(files);

    // Проверка количества
    if (allFiles.length + fileArray.length > maxFiles) {
      setError(`Максимум ${maxFiles} файлов`);
      return;
    }

    // Проверка размеров
    const oversizedFiles = fileArray.filter(f => f.size > maxSize);
    if (oversizedFiles.length > 0) {
      setError(`Некоторые файлы превышают ${formatFileSize(maxSize)}`);
      return;
    }

    fileArray.forEach(uploadNewFile);
  };

  // Обработка выбора файлов через input
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
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
      processFiles(files);
    }
  };

  // Клик по зоне загрузки
  const handleZoneClick = () => {
    inputRef.current?.click();
  };

  // Удаление файла
  const handleDelete = (file: AttachmentFile) => {
    if (file._isNew && file._localId) {
      // Удаляем из новых; ещё грузится — отменяем загрузку
      uploads.forget(file._localId);
      setCreated(getNewFiles().filter(f => f._localId !== file._localId));
    } else if (file.id) {
      // Добавляем в deleted
      form.setValues({
        ['_' + name]: {
          deleted: [...deletedIds, file.id],
          created: getNewFiles(),
          fieldsServer: fieldsServer,
        },
      });
    }
  };

  // Ещё не сохранённый файл строки — из памяти браузера
  const localFile = (file: AttachmentFile) =>
    file._isNew && file._localId ? uploads.files[file._localId] : undefined;

  // Скачивание файла
  const handleDownload = (file: AttachmentFile) => {
    const local = localFile(file);
    if (file.id && !file._isNew) {
      downloadAttachment(file.id, file.name);
    } else if (local) {
      downloadBlob(local, file.name);
    }
  };

  // Картинки — со стрелками по картинкам поля (новые — из памяти
  // браузера); остальные файлы AttachmentPreview открывает сам
  const handleViewImage = (index: number) => {
    const items = allFiles.map(f => ({
      id: f.id,
      name: f.name,
      mimetype: f.mimetype,
      file: localFile(f),
    }));
    attachmentViewer.open(
      items[index],
      items.filter(item => isImageMimetype(item.mimetype)),
    );
  };

  const canAddMore = allFiles.length < maxFiles;

  return (
    <Stack gap="xs">
      {label && (
        <Text size="sm" fw={500}>
          {label}
        </Text>
      )}

      {/* Скрытый input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />

      {/* Сетка файлов */}
      {allFiles.length > 0 && (
        <SimpleGrid cols={columns} spacing="xs">
          {allFiles.map((file, index) => (
            <AttachmentPreview
              key={file.id || file._localId || index}
              attachment={{
                id: file.id,
                name: file.name,
                mimetype: file.mimetype,
                size: file.size,
                file: localFile(file),
              }}
              progress={
                file._localId ? (uploads.progress[file._localId] ?? null) : null
              }
              onDelete={() => handleDelete(file)}
              onDownload={() => handleDownload(file)}
              onClick={
                isImageMimetype(file.mimetype)
                  ? () => handleViewImage(index)
                  : undefined
              }
              showPreview={(file as any).show_preview !== false && showPreview}
              previewSize={previewSize}
              showActions={true}
            />
          ))}

          {/* Кнопка добавления */}
          {canAddMore && (
            <Box
              className={classes.addButton}
              style={{ width: previewSize, height: previewSize }}
              onClick={handleZoneClick}>
              <IconPlus size={32} stroke={1.5} color={theme.colors.gray[5]} />
            </Box>
          )}
        </SimpleGrid>
      )}

      {/* Зона загрузки (если нет файлов) */}
      {allFiles.length === 0 && (
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

            <div>
              <Text size="sm" inline>
                {isUploading ? t('loading') : t('dropzone.dropFiles')}
              </Text>
              <Text size="xs" c="dimmed" inline mt={7}>
                {t('dropzone.maxFilesAndSize', {
                  files: maxFiles,
                  size: formatFileSize(maxSize),
                })}
              </Text>
            </div>
          </Group>
        </Box>
      )}

      {/* Ошибка */}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}

      {/* Окно просмотра */}
      {attachmentViewer.modal}
    </Stack>
  );
};
