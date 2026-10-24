/**
 * AttachmentPreviewCard — превью карточка вложения для использования в Form.
 *
 * Поддерживает:
 *   - Превью существующих файлов через attachmentPreviewUrl(id) (без fetch)
 *   - Новый файл грузится частями сразу при выборе (useUploadFile), в форму
 *     идёт его upload_id; превью — из памяти браузера (blob)
 *   - Drag & drop для загрузки/замены файла
 *   - Клик по зоне для выбора файла
 *
 * Данные берёт из useFormContext().
 *
 * Использование:
 *   <Form model="attachments">
 *     <AttachmentPreviewCard />
 *     ...
 *   </Form>
 */
import { useState, useRef, ChangeEvent, DragEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Paper,
  Group,
  Stack,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  Box,
  Image,
  Divider,
  Loader,
} from '@mantine/core';
import {
  IconDownload,
  IconEdit,
  IconEye,
  IconFolder,
  IconLock,
  IconWorld,
  IconMicrophone,
  IconUpload,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import { useFormContext } from '@/components/Form/FormContext';
import { useObjectUrl } from '@/hooks/useObjectUrl';
import { fileMimetype, useFileUploads } from '@/hooks/useFileUploads';
import { FileIcon } from './FileIcon';
import { AttachmentEditorModal } from './AttachmentEditorModal';
import { AudioPlayer } from './AudioPlayer';
import { UploadProgress } from './UploadProgress';
import { canViewAttachment, useAttachmentViewer } from './useAttachmentViewer';
import { canEditAttachment } from './viewKind';
import {
  isImageMimetype,
  isAudioMimetype,
  isVideoMimetype,
  formatFileSize,
} from './fileIcons';
import {
  attachmentPreviewUrl,
  downloadAttachment,
  downloadBlob,
} from '@/utils/attachmentUrls';
import classes from './AttachmentPreviewCard.module.css';

// Как attachments.max_upload_size по умолчанию; больший сервер отклонит сам
const DEFAULT_MAX_SIZE = 1024 * 1024 * 1024; // 1 GB

interface AttachmentPreviewCardProps {
  /** Максимальный размер файла в байтах. По умолчанию 1 GB. */
  maxSize?: number;
}

export function AttachmentPreviewCard({
  maxSize = DEFAULT_MAX_SIZE,
}: AttachmentPreviewCardProps = {}) {
  const form = useFormContext();
  const { t } = useTranslation('common');
  const params = useParams<{ id: string }>();
  const inputRef = useRef<HTMLInputElement>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const attachmentViewer = useAttachmentViewer();
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Новый файл: в памяти браузера — для превью, на сервер — частями
  const uploads = useFileUploads();
  const newFile = uploads.files.file ?? null;
  const newFileUrl = useObjectUrl(newFile);
  const progress = uploads.progress.file ?? null;
  const isUploading = progress !== null;
  // Поля формы до нового файла — вернуть, если загрузка не удалась
  const beforeUploadRef = useRef<Record<string, unknown>>({});

  const values = form.getValues() || {};

  // ID берём из URL (для существующих) или из values (если есть)
  const idFromUrl = params.id ? parseInt(params.id, 10) : null;
  const id = idFromUrl || values.id;

  // Метаданные из формы
  const mimetype = values.mimetype as string | undefined;
  const name = (values.name as string) || '';
  const size = values.size as number | undefined;
  const checksum = values.checksum as string | undefined;
  const isPublic = values.public as boolean | undefined;
  const isVoice = values.is_voice as boolean | undefined;
  const showPreview = values.show_preview !== false;
  const folder = values.folder;
  // Новый, ещё не сохранённый файл: загрузка частями в форме — upload_id
  const isNewFile = !!values.upload_id;

  const isImage = mimetype ? isImageMimetype(mimetype) : false;
  const isAudio = mimetype ? isAudioMimetype(mimetype) : false;
  const isVideo = mimetype ? isVideoMimetype(mimetype) : false;

  const hasFile = !!(id || isNewFile);
  // Правка docx и xlsx во встроенном редакторе — только сохранённого файла
  const canEdit = !!id && !isNewFile && canEditAttachment(mimetype, name);
  // Аудио сохранённого файла играет прямо в превью
  const canPlayAudio = !!id && !isNewFile && isAudio;
  // Просмотр без скачивания: сохранённый файл или ещё не сохранённая
  // картинка (из памяти браузера). Docx и xlsx открывает своя кнопка
  // «Редактировать», аудио — плеер в превью.
  const canView =
    !canEdit &&
    !isAudio &&
    canViewAttachment({ mimetype, name }) &&
    (isNewFile ? isImage && !!newFile : !!id);

  // URL изображения по приоритету
  let imageSrc: string | null = null;
  if (isImage && showPreview) {
    if (isNewFile) {
      imageSrc = newFileUrl;
    } else if (id) {
      imageSrc = attachmentPreviewUrl(id, undefined, undefined, checksum);
    }
  }

  // ─── File handling ───

  const processFile = async (file: File) => {
    setError(null);

    if (file.size > maxSize) {
      setError(`Файл слишком большой. Максимум: ${formatFileSize(maxSize)}`);
      return;
    }

    if (!isNewFile) {
      beforeUploadRef.current = {
        name: values.name ?? '',
        mimetype: values.mimetype ?? '',
        size: values.size ?? 0,
      };
    }
    try {
      // Поля и upload_id — в форму сразу: «Сохранить» до конца загрузки
      // сервер отклонит (загрузка не завершена), а не создаст вложение без
      // файла. Модель Attachment имеет эти поля на верхнем уровне.
      await uploads.start('file', file, uploadId =>
        form.setValues({
          name: file.name,
          mimetype: fileMimetype(file),
          size: file.size,
          upload_id: uploadId,
        }),
      );
    } catch (err) {
      console.error('Ошибка загрузки файла:', err);
      setError('Ошибка загрузки файла');
      form.setValues({ ...beforeUploadRef.current, upload_id: null });
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

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

  const handleZoneClick = () => {
    inputRef.current?.click();
  };

  const handleReplace = (e: React.MouseEvent) => {
    e.stopPropagation();
    inputRef.current?.click();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    uploads.forget('file');
    form.setValues({
      name: '',
      mimetype: '',
      size: 0,
      upload_id: null,
    });
    setError(null);
  };

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    attachmentViewer.open({
      id: id ? Number(id) : undefined,
      name,
      mimetype,
      checksum,
      file: isNewFile ? newFile : undefined,
    });
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isNewFile && newFile) {
      downloadBlob(newFile, name);
    } else if (id) {
      downloadAttachment(id, name);
    }
  };

  // ─── Render ───

  // Hidden file input — общий для всех режимов
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      style={{ display: 'none' }}
      onChange={handleInputChange}
    />
  );

  // Empty state — нет файла, показываем зону загрузки
  if (!hasFile) {
    return (
      <>
        <Paper
          className={classes.previewCard}
          withBorder
          p="md"
          radius="md"
          data-drag-over={isDragOver || undefined}
          onClick={handleZoneClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            cursor: 'pointer',
            borderStyle: 'dashed',
            borderColor: isDragOver
              ? 'var(--mantine-color-blue-6)'
              : undefined,
          }}>
          <Stack align="center" gap="sm" py="xl">
            {isUploading ? (
              <Loader size="md" />
            ) : (
              <IconUpload
                size={48}
                stroke={1.5}
                color="var(--mantine-color-gray-6)"
              />
            )}
            <Text size="md" fw={500}>
              {isUploading
                ? t('loading')
                : isDragOver
                  ? t('dropzone.releaseFile')
                  : t('dropzone.dropFileShort')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('dropzone.maxSizeShort', { size: formatFileSize(maxSize) })}
            </Text>
            {error && (
              <Text size="sm" c="red">
                {error}
              </Text>
            )}
          </Stack>
        </Paper>
        {fileInput}
      </>
    );
  }

  // File state — есть файл, показываем превью
  return (
    <>
      <Paper
        className={classes.previewCard}
        withBorder
        p="md"
        radius="md"
        data-drag-over={isDragOver || undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          borderColor: isDragOver
            ? 'var(--mantine-color-blue-6)'
            : undefined,
          borderStyle: isDragOver ? 'dashed' : undefined,
        }}>
        {/* Превью */}
        <Box className={classes.previewArea} onClick={handleZoneClick}>
          {isUploading ? (
            <UploadProgress value={progress} />
          ) : imageSrc ? (
            <Image
              src={imageSrc}
              alt={name}
              fit="contain"
              mah={300}
              radius="md"
              style={{ cursor: 'pointer' }}
              onClick={handleView}
            />
          ) : canPlayAudio ? (
            // Клик по плееру не должен открывать выбор файла
            <Box w="100%" maw={400} onClick={e => e.stopPropagation()}>
              <AudioPlayer attachmentId={Number(id)} />
            </Box>
          ) : (
            <Box
              className={classes.iconArea}
              style={{ cursor: 'pointer' }}>
              <FileIcon
                mimetype={mimetype || 'application/octet-stream'}
                size={80}
              />
              <Text size="xs" c="dimmed" mt="xs">
                Нажмите чтобы заменить
              </Text>
            </Box>
          )}
        </Box>

        <Divider my="md" />

        {/* Информация о файле */}
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="lg" fw={600} lineClamp={1}>
              {name || 'Без имени'}
            </Text>
            <Group gap="xs">
              {canView && (
                <Tooltip label="Просмотр">
                  <ActionIcon variant="light" color="blue" onClick={handleView}>
                    <IconEye size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              {canEdit && (
                <Tooltip label={t('docxEditor.edit')}>
                  <ActionIcon
                    variant="light"
                    color="blue"
                    onClick={e => {
                      e.stopPropagation();
                      setEditorOpen(true);
                    }}>
                    <IconEdit size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label="Заменить файл">
                <ActionIcon
                  variant="light"
                  color="gray"
                  onClick={handleReplace}>
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>
              {(isNewFile ? !!newFile : !!id) && (
                <Tooltip label="Скачать">
                  <ActionIcon
                    variant="light"
                    color="gray"
                    onClick={handleDownload}>
                    <IconDownload size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              {isNewFile && !id && (
                <Tooltip label="Очистить">
                  <ActionIcon
                    variant="light"
                    color="red"
                    onClick={handleClear}>
                    <IconX size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Group>

          <Group gap="xs">
            {size != null && size > 0 && (
              <Badge size="sm" variant="light" color="gray">
                {formatFileSize(size)}
              </Badge>
            )}

            {folder && (
              <Badge
                size="sm"
                color="yellow"
                leftSection={<IconFolder size={10} />}>
                Папка
              </Badge>
            )}

            {isVoice && (
              <Badge
                size="sm"
                color="pink"
                leftSection={<IconMicrophone size={10} />}>
                Голосовое
              </Badge>
            )}

            {isImage && (
              <Badge size="sm" color="teal">
                Изображение
              </Badge>
            )}

            {isVideo && (
              <Badge size="sm" color="violet">
                Видео
              </Badge>
            )}

            {isAudio && !isVoice && (
              <Badge size="sm" color="pink">
                Аудио
              </Badge>
            )}

            {isPublic !== undefined && (
              <Badge
                size="sm"
                variant="light"
                color={isPublic ? 'green' : 'gray'}
                leftSection={
                  isPublic ? <IconWorld size={10} /> : <IconLock size={10} />
                }>
                {isPublic ? 'Публичный' : 'Приватный'}
              </Badge>
            )}
          </Group>

          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Paper>

      {canEdit && (
        <AttachmentEditorModal
          attachmentId={Number(id)}
          filename={name}
          mimetype={mimetype}
          opened={editorOpen}
          onClose={() => setEditorOpen(false)}
        />
      )}

      {attachmentViewer.modal}

      {fileInput}
    </>
  );
}

AttachmentPreviewCard.displayName = 'AttachmentPreviewCard';
