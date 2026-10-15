import { ActionIcon, Tooltip } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useFormContext } from '../FormContext';
import { FieldChar } from './FieldChar';

/** Адрес для перехода: без схемы («site.ru») — https. Заодно чужая схема
 *  (javascript:) не исполнится, а станет адресом https. */
const toHref = (value: string) =>
  /^https?:\/\//i.test(value) ? value : `https://${value}`;

/**
 * Строка-ссылка (widget="charUrl"): обычное редактируемое поле, справа —
 * иконка, открывающая адрес в новой вкладке.
 */
export const FieldCharUrl = (props: { name: string; [key: string]: any }) => {
  const { t } = useTranslation('common');
  const form = useFormContext();
  const label = t('openLink', 'Открыть ссылку');

  const handleOpen = () => {
    const value = String(form.getValues()[props.name] ?? '').trim();
    if (value) window.open(toHref(value), '_blank', 'noopener,noreferrer');
  };

  return (
    <FieldChar
      {...props}
      rightSection={
        <Tooltip label={label} withArrow>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={label}
            onClick={handleOpen}>
            <IconExternalLink size={16} />
          </ActionIcon>
        </Tooltip>
      }
      rightSectionPointerEvents="auto"
    />
  );
};
