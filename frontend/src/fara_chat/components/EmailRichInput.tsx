import { useEffect, useRef } from 'react';
import { RichTextEditor } from '@mantine/tiptap';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import styles from './EmailRichInput.module.css';

interface EmailRichInputProps {
  /** Начальное содержимое для неконтролируемого режима. */
  initialHtml?: string;
  value?: string;
  ariaLabel?: string;
  onChange: (html: string) => void;
  /** Ctrl/Cmd+Enter — отправить (Enter = перенос строки, как в почте). */
  onSend: () => void;
  disabled?: boolean;
}

/**
 * Rich-text поле для писем: жирный/курсив/подчёркивание + маркированный и
 * нумерованный списки. Отдаёт HTML, который бэкенд email-стратегии умеет
 * слать (plain-часть + html-часть). Показывается только когда в чате выбран
 * email-коннектор (см. ChatInput).
 */
export function EmailRichInput({
  initialHtml = '',
  value,
  ariaLabel,
  onChange,
  onSend,
  disabled,
}: EmailRichInputProps) {
  // Держим последние колбэки в ref, чтобы не пересоздавать editor (это сбросило
  // бы контент) при каждом ре-рендере родителя.
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Underline,
    ],
    content: value ?? initialHtml,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getHTML());
    },
    editorProps: {
      attributes: ariaLabel ? { 'aria-label': ariaLabel } : {},
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onSendRef.current();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [disabled, editor]);

  useEffect(() => {
    if (editor && value !== undefined && editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return null;

  return (
    <RichTextEditor editor={editor} className={styles.editor}>
      <RichTextEditor.Toolbar>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Bold />
          <RichTextEditor.Italic />
          <RichTextEditor.Underline />
        </RichTextEditor.ControlsGroup>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.BulletList />
          <RichTextEditor.OrderedList />
        </RichTextEditor.ControlsGroup>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Link />
          <RichTextEditor.Unlink />
        </RichTextEditor.ControlsGroup>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.ClearFormatting />
        </RichTextEditor.ControlsGroup>
      </RichTextEditor.Toolbar>
      <RichTextEditor.Content className={styles.content} />
    </RichTextEditor>
  );
}

export default EmailRichInput;
