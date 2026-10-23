import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Box,
  TextInput,
  ActionIcon,
  Group,
  FileButton,
  Tooltip,
  Menu,
  Popover,
  SimpleGrid,
  Text,
} from '@mantine/core';
import {
  IconSend,
  IconPaperclip,
  IconMoodSmile,
  IconPhoto,
  IconFile,
  IconX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import {
  useSendMessageMutation,
  useGetChatEmailSubjectQuery,
} from '@/services/api/chat';
import {
  AttachmentPreview,
  VoiceRecorder,
  isImageMimetype,
  formatFileSize,
  useAttachmentViewer,
} from '@/components/Attachment';
import { EmojiPicker } from './EmojiPicker';
import { ConnectorSwitcher, ConnectorOption } from './ConnectorSwitcher';
import { EmailRichInput } from './EmailRichInput';
import styles from './ChatInput.module.css';

/** Достать простой текст из HTML — для проверки «пусто ли письмо». */
function htmlToPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

interface AttachmentFile {
  name: string;
  mimetype: string;
  size: number;
  content: string;
  _localId: string;
}

interface ChatInputProps {
  chatId: number;
  currentUserId: number;
  currentUserName?: string;
  onTyping?: () => void;
  connectorId?: number;
  disabled?: boolean;
  // Для ConnectorSwitcher (иконка выбора канала)
  connectors?: ConnectorOption[];
  onConnectorSelect?: (connectorId: number | null) => void;
  // Коннектор по умолчанию (галочка в свитчере) + сохранение выбора default.
  defaultConnectorId?: number | null;
  onSetDefaultConnector?: (connectorId: number | null) => void;
  // Callback после отправки сообщения
  onMessageSent?: () => void;
  // Теги: к какому лиду/задаче привязать исходящее (панель чата партнёра на
  // форме лида/задачи проставляет автоматически). Уходят в message.lead_id/task_id.
  leadId?: number | null;
  taskId?: number | null;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 10;

export function ChatInput({
  chatId,
  currentUserId,
  currentUserName,
  onTyping,
  connectorId,
  disabled,
  connectors,
  onConnectorSelect,
  defaultConnectorId,
  onSetDefaultConnector,
  onMessageSent,
  leadId,
  taskId,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [message, setMessage] = useState('');
  // Тема письма (для email). Дефолт подтягивается из ручки (имя чата или тема
  // последнего письма); пользователь может переопределить.
  const [subject, setSubject] = useState('');
  // Ключ для ремонта rich-редактора письма после отправки (очистка контента).
  const [composerKey, setComposerKey] = useState(0);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [emojiOpened, setEmojiOpened] = useState(false);
  const attachmentViewer = useAttachmentViewer();
  const [, setIsRecording] = useState(false);

  const [sendMessage] = useSendMessageMutation();
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<() => void>(null);
  const fileInputRef = useRef<() => void>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Голосовое сообщение готово к отправке
  const [pendingVoice, setPendingVoice] = useState<{
    name: string;
    mimetype: string;
    size: number;
    content: string;
    is_voice: boolean;
  } | null>(null);

  // Счётчик для сброса VoiceRecorder после отправки
  const [voiceResetKey, setVoiceResetKey] = useState(0);

  // Выбран ли email-коннектор — тогда показываем rich-редактор письма
  // (более высокое поле + форматирование), а не однострочный ввод.
  const selectedConnector = connectors?.find(
    c => c.connector_id === connectorId,
  );
  const isEmail = selectedConnector?.connector_type === 'email';
  // Тип коннектора для оптимистик-рендера (email → HTML сразу).
  const selectedConnectorType = selectedConnector?.connector_type;

  // Дефолтная тема письма (имя чата / тема последнего письма). Грузим только
  // для email. Подставляем в поле при смене чата/появлении данных; правки
  // пользователя не затираем, т.к. без инвалидации ручка не перезапрашивается.
  const { data: emailSubjectData } = useGetChatEmailSubjectQuery(
    { chatId },
    { skip: !isEmail },
  );
  const defaultSubject = emailSubjectData?.data?.subject;
  useEffect(() => {
    if (isEmail && defaultSubject !== undefined) {
      setSubject(defaultSubject);
    }
    // Сбрасываем к дефолту при смене чата и при первой загрузке данных.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, defaultSubject, isEmail]);

  // Есть ли что отправлять (для email проверяем текст письма без HTML-тегов).
  const hasText = isEmail
    ? htmlToPlainText(message).trim().length > 0
    : message.trim().length > 0;

  const handleSend = useCallback(async () => {
    // Для письма тело — HTML; иначе обычный текст.
    const plain = isEmail ? htmlToPlainText(message).trim() : message.trim();

    // Отправка голосового сообщения
    if (pendingVoice) {
      try {
        await sendMessage({
          chatId,
          body: ' ',
          connector_id: connectorId,
          connector_type: selectedConnectorType,
          lead_id: leadId,
          task_id: taskId,
          currentUserId,
          currentUserName,
          attachments: [pendingVoice],
        }).unwrap();
        setPendingVoice(null);
        setIsRecording(false);
        setVoiceResetKey(k => k + 1); // Сбрасываем VoiceRecorder
        onMessageSent?.();
      } catch (error) {
        console.error('Failed to send voice message:', error);
      }
      return;
    }

    // Обычное сообщение / письмо
    if ((!plain && attachments.length === 0) || disabled) return;

    // Для email тело — «email-формат» {subject, html} (тема едет внутри body,
    // как system хранит JSON). Для остального — обычный plain-текст.
    const bodyToSend = isEmail
      ? JSON.stringify({ subject: subject.trim(), html: plain ? message : '' })
      : plain || ' ';

    try {
      await sendMessage({
        chatId,
        body: bodyToSend,
        connector_id: connectorId,
        connector_type: selectedConnectorType,
        currentUserId,
        currentUserName,
        attachments:
          attachments.length > 0
            ? attachments.map(({ name, mimetype, size, content }) => ({
                name,
                mimetype,
                size,
                content,
              }))
            : undefined,
      }).unwrap();

      setMessage('');
      setComposerKey(k => k + 1); // очистить rich-редактор письма
      setAttachments([]);
      inputRef.current?.focus();
      onMessageSent?.();
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }, [
    message,
    isEmail,
    attachments,
    pendingVoice,
    chatId,
    connectorId,
    currentUserId,
    currentUserName,
    disabled,
    sendMessage,
    onMessageSent,
    selectedConnectorType,
    subject,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);

    if (onTyping) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      onTyping();
      typingTimeoutRef.current = setTimeout(() => {
        typingTimeoutRef.current = null;
      }, 2000);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setMessage(prev => prev + emoji);
    setEmojiOpened(false);
    inputRef.current?.focus();
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (files: File[] | null) => {
    if (!files || files.length === 0) return;

    if (attachments.length + files.length > MAX_FILES) {
      console.warn(`Maximum ${MAX_FILES} files allowed`);
      return;
    }

    const newAttachments: AttachmentFile[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        console.warn(
          `File ${file.name} exceeds ${formatFileSize(MAX_FILE_SIZE)}`,
        );
        continue;
      }

      try {
        const content = await readFileAsBase64(file);
        newAttachments.push({
          name: file.name,
          mimetype: file.type || 'application/octet-stream',
          size: file.size,
          content,
          _localId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        });
      } catch (err) {
        console.error('Error reading file:', err);
      }
    }

    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  };

  const handleRemoveAttachment = (localId: string) => {
    setAttachments(prev => prev.filter(a => a._localId !== localId));
  };

  const handleVoiceRecorded = async (voiceFile: {
    name: string;
    mimetype: string;
    size: number;
    content: string;
    is_voice: boolean;
  }) => {
    // Отправляем голосовое сообщение сразу
    try {
      await sendMessage({
        chatId,
        body: '',
        connector_id: connectorId,
        connector_type: selectedConnectorType,
        currentUserId,
        currentUserName,
        attachments: [voiceFile],
      }).unwrap();
      setIsRecording(false);
    } catch (error) {
      console.error('Failed to send voice message:', error);
    }
  };

  // Ещё не отправленные картинки — из base64, со стрелками по соседним
  // картинкам (остальные файлы без id окну показать нечем)
  const handleViewAttachment = (index: number) => {
    const items = attachments.map(a => ({
      name: a.name,
      mimetype: a.mimetype,
      content: a.content,
    }));
    attachmentViewer.open(
      items[index],
      items.filter(item => isImageMimetype(item.mimetype)),
    );
  };

  const canAddMore = attachments.length < MAX_FILES;

  const handleClearAllAttachments = () => {
    setAttachments([]);
  };

  const canSend = hasText || attachments.length > 0 || !!pendingVoice;

  // Кнопки, общие для письма и обычного сообщения.
  const attachMenu = (
    <Menu position="top-start" withArrow>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          size="lg"
          disabled={disabled || !canAddMore}
          title={t('attach')}>
          <IconPaperclip size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconPhoto size={16} />}
          onClick={() => document.getElementById('image-input')?.click()}>
          {t('attachImage')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconFile size={16} />}
          onClick={() => document.getElementById('file-input')?.click()}>
          {t('attachFile')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  // Переключатель коннектора — иконка канала (subtle, как скрепка).
  const connectorSwitcher = connectors &&
    connectors.length > 1 &&
    onConnectorSelect && (
      <ConnectorSwitcher
        connectors={connectors}
        selectedConnectorId={connectorId ?? null}
        onSelect={onConnectorSelect}
        defaultConnectorId={defaultConnectorId ?? null}
        onSetDefault={onSetDefaultConnector}
        disabled={disabled}
      />
    );

  const sendButton = (
    <Tooltip label={t('send')} position="top">
      <ActionIcon
        variant="filled"
        size="lg"
        radius="xl"
        onClick={handleSend}
        disabled={!canSend || disabled}>
        <IconSend size={18} />
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Box className={styles.container}>
      {attachments.length > 0 && (
        <Box className={styles.attachmentsPreview}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed">
              {t('attachedFiles', { count: attachments.length })}
            </Text>
            <ActionIcon
              variant="subtle"
              size="xs"
              color="gray"
              onClick={handleClearAllAttachments}
              title={t('clearAll')}>
              <IconX size={14} />
            </ActionIcon>
          </Group>
          <SimpleGrid cols={6} spacing="xs">
            {attachments.map((file, index) => (
              <AttachmentPreview
                key={file._localId}
                attachment={{
                  name: file.name,
                  mimetype: file.mimetype,
                  size: file.size,
                  content: file.content,
                }}
                onDelete={() => handleRemoveAttachment(file._localId)}
                onClick={
                  isImageMimetype(file.mimetype)
                    ? () => handleViewAttachment(index)
                    : undefined
                }
                showPreview={true}
                previewSize={60}
                compact
              />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {/* Hidden FileButtons */}
      <FileButton
        onChange={handleFileSelect}
        accept="image/*"
        multiple
        resetRef={imageInputRef}>
        {props => (
          <button {...props} style={{ display: 'none' }} id="image-input" />
        )}
      </FileButton>
      <FileButton
        onChange={handleFileSelect}
        accept="*/*"
        multiple
        resetRef={fileInputRef}>
        {props => (
          <button {...props} style={{ display: 'none' }} id="file-input" />
        )}
      </FileButton>

      {isEmail ? (
        // Письмо — тема (хедер) + rich-редактор (жирный/курсив/списки).
        // key=composerKey ремонтит редактор после отправки для очистки.
        // Enter = перенос строки, Ctrl/Cmd+Enter = отправка.
        <Group gap="xs" wrap="nowrap" align="flex-end">
          {attachMenu}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              value={subject}
              onChange={e => setSubject(e.currentTarget.value)}
              placeholder={t('emailSubject', 'Тема письма')}
              disabled={disabled}
              size="sm"
              mb={6}
            />
            <EmailRichInput
              key={composerKey}
              initialHtml={message}
              onChange={setMessage}
              onSend={handleSend}
              disabled={disabled}
            />
          </Box>
          {connectorSwitcher}
          {sendButton}
        </Group>
      ) : (
        // Как в Telegram: одно закруглённое поле, кнопки внутри него; справа
        // микрофон, пока отправлять нечего, иначе на его месте «Отправить».
        <Group gap="xs" wrap="nowrap">
          {/* Пока голосовое ждёт отправки, поля нет: уйдёт только запись, а
              на мобильном плееру и кнопке «Отправить» нужна вся строка (#40). */}
          {!pendingVoice && (
            <Box className={styles.field}>
              <Popover
                opened={emojiOpened}
                onChange={setEmojiOpened}
                position="top-start"
                withArrow
                shadow="md">
                <Popover.Target>
                  <ActionIcon
                    variant="subtle"
                    size="lg"
                    disabled={disabled}
                    title={t('emoji')}
                    onClick={() => setEmojiOpened(o => !o)}>
                    <IconMoodSmile size={20} />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown p={0}>
                  <EmojiPicker onSelect={handleEmojiSelect} />
                </Popover.Dropdown>
              </Popover>
              <TextInput
                ref={inputRef}
                variant="unstyled"
                className={styles.input}
                placeholder={t('typeMessage')}
                value={message}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
              {attachMenu}
              {connectorSwitcher}
            </Box>
          )}
          {!hasText && attachments.length === 0 && (
            <VoiceRecorder
              key={voiceResetKey}
              onRecorded={handleVoiceRecorded}
              onRecordingReady={setPendingVoice}
              onCancel={() => {
                setIsRecording(false);
                setPendingVoice(null);
              }}
              disabled={disabled}
              showSendButton={false}
            />
          )}
          {canSend && sendButton}
        </Group>
      )}

      {attachmentViewer.modal}
    </Box>
  );
}

export default ChatInput;
