/**
 * Окно просмотра вложений — одно для всех типов (картинки, видео, аудио,
 * текст, Markdown, письма), со стрелками между файлами. Открывает
 * его useAttachmentViewer; что во что попадает — getViewKind.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Box, Group, Modal, Text } from '@mantine/core';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconExternalLink,
  IconX,
} from '@tabler/icons-react';
import {
  attachmentPreviewUrl,
  downloadAttachment,
  downloadBase64,
  openAttachmentInBrowser,
} from '@/utils/attachmentUrls';
import { canOpenTextInTab, getViewKind } from '../viewKind';
import type { ViewableAttachment } from '../useAttachmentViewer';
import { ToolbarButton } from './ToolbarButton';
import { ImageControls, ImageView } from './ImageView';
import { AudioView, VideoView } from './MediaView';
import { MarkdownView } from './MarkdownView';
import { EmailView } from './EmailView';
import { TextView } from './TextView';
import classes from './AttachmentViewerModal.module.css';

function ViewerBody({
  item,
  src,
  zoom,
  rotation,
}: {
  item: ViewableAttachment;
  src: string;
  zoom: number;
  rotation: number;
}) {
  switch (getViewKind(item)) {
    case 'image':
      return (
        <ImageView src={src} name={item.name} zoom={zoom} rotation={rotation} />
      );
    case 'video':
      return <VideoView src={src} />;
    case 'audio':
      return <AudioView src={src} />;
    case 'markdown':
      return <MarkdownView attachmentId={item.id!} />;
    case 'email':
      return <EmailView attachmentId={item.id!} />;
    case 'text':
      return (
        <TextView
          attachmentId={item.id!}
          mimetype={item.mimetype}
          name={item.name}
        />
      );
    default:
      return null;
  }
}

interface AttachmentViewerModalProps {
  items: ViewableAttachment[];
  initialIndex: number;
  onClose: () => void;
}

export function AttachmentViewerModal({
  items,
  initialIndex,
  onClose,
}: AttachmentViewerModalProps) {
  const [index, setIndex] = useState(initialIndex);
  // Масштаб и поворот картинки — здесь, а не в ImageView: их кнопки в тулбаре
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const item = items[index];
  const kind = getViewKind(item);
  const hasMany = items.length > 1;

  // Ещё не сохранённый файл — из base64, сохранённый — превью-роутом
  const src = item.content
    ? `data:${item.mimetype};base64,${item.content}`
    : attachmentPreviewUrl(item.id!, undefined, undefined, item.checksum);

  const go = useCallback(
    (step: number) => {
      setIndex(value => (value + step + items.length) % items.length);
      setZoom(1);
      setRotation(0);
    },
    [items.length],
  );

  // ← → между файлами; стрелки в плеере и во вкладках листов — их собственные
  useEffect(() => {
    if (!hasMany) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('video, audio, [role="tablist"]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasMany, go]);

  const handleDownload = () => {
    if (item.content) {
      downloadBase64(item.content, item.mimetype ?? '', item.name ?? undefined);
    } else {
      downloadAttachment(item.id!, item.name ?? undefined);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen
      padding={0}
      withCloseButton={false}
      classNames={{ content: classes.content, body: classes.body }}>
      <Group className={classes.toolbar} justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" miw={0}>
          <Text size="sm" c="white" truncate>
            {item.name}
          </Text>
          {hasMany && (
            <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
              {index + 1} / {items.length}
            </Text>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {/* Большой лог, файл рядом с CRM — во вкладке браузера */}
          {kind === 'text' && !!item.id && canOpenTextInTab(item.mimetype) && (
            <ToolbarButton
              label="Открыть во вкладке"
              icon={IconExternalLink}
              onClick={() => openAttachmentInBrowser(item.id!, item.checksum)}
            />
          )}
          {kind === 'image' && (
            <>
              <ImageControls
                src={src}
                zoom={zoom}
                setZoom={setZoom}
                setRotation={setRotation}
              />
              <Box w={16} />
            </>
          )}
          <ToolbarButton
            label="Скачать"
            icon={IconDownload}
            onClick={handleDownload}
          />
          <ToolbarButton label="Закрыть" icon={IconX} onClick={onClose} />
        </Group>
      </Group>

      {hasMany && (
        <>
          <ActionIcon
            className={classes.navButton}
            style={{ left: 16 }}
            variant="filled"
            color="dark"
            size="xl"
            radius="xl"
            onClick={() => go(-1)}>
            <IconChevronLeft size={28} />
          </ActionIcon>
          <ActionIcon
            className={classes.navButton}
            style={{ right: 16 }}
            variant="filled"
            color="dark"
            size="xl"
            radius="xl"
            onClick={() => go(1)}>
            <IconChevronRight size={28} />
          </ActionIcon>
        </>
      )}

      {/* key — у каждого файла своя загрузка и ошибка */}
      <Box key={index} className={classes.stage}>
        <ViewerBody item={item} src={src} zoom={zoom} rotation={rotation} />
      </Box>
    </Modal>
  );
}
