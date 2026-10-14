/**
 * Кнопка «Лиды» в тулбаре формы партнёра: число лидов клиента
 * (Lead.partner_id),
 * клик — список лидов с фильтром по партнёру. Модуль партнёров о лидах
 * не знает — кнопку ставит этот модуль.
 *
 * Подключение: fara_leads/index.ts (side-effect импорт) и
 * config/models.ts (modelsConfig.partners.extensions).
 */

import { IconHeartHandshake } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { RelatedRecordsButton } from '@/components/Form/RelatedRecordsButton';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { registerExtension } from '@/shared/extensions';

export function PartnerLeadsButton() {
  const { t } = useTranslation('leads');
  const { isInstalled } = useInstalledApps();
  // Без приложения нет маршрута /auto/leads — запрос ушёл бы в 404
  if (!isInstalled('leads')) return null;
  return (
    <RelatedRecordsButton
      model="leads"
      field="partner_id"
      label={t('leads.title')}
      icon={<IconHeartHandshake size={16} />}
    />
  );
}

registerExtension('partners', PartnerLeadsButton, 'inside:Toolbar');
