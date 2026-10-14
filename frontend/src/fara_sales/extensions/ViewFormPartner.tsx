/**
 * Кнопка «Заказы» в тулбаре формы партнёра: число заказов клиента
 * (Sale.partner_id),
 * клик — список продаж с фильтром по партнёру. Модуль партнёров о продажах
 * не знает — кнопку ставит этот модуль.
 *
 * Подключение: fara_sales/index.ts (side-effect импорт) и
 * config/models.ts (modelsConfig.partners.extensions).
 */

import { IconShoppingCart } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { RelatedRecordsButton } from '@/components/Form/RelatedRecordsButton';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { registerExtension } from '@/shared/extensions';

export function PartnerSalesButton() {
  const { t } = useTranslation('sales');
  const { isInstalled } = useInstalledApps();
  // Без приложения нет маршрута /auto/sales — запрос ушёл бы в 404
  if (!isInstalled('sales')) return null;
  return (
    <RelatedRecordsButton
      model="sales"
      field="partner_id"
      label={t('menu.sale')}
      icon={<IconShoppingCart size={16} />}
    />
  );
}

registerExtension('partners', PartnerSalesButton, 'inside:Toolbar');
