/**
 * Кнопка связанных записей в тулбаре формы: подпись и число записей model,
 * у которых field = текущая запись, клик — список model с этим фильтром
 * (state.initialFilter, как у FieldX2mButton). Ставит модуль связанной
 * модели расширением 'inside:Toolbar', например «Заказы» партнёра из
 * fara_sales.
 *
 * Число — отдельный тихий запрос (searchCount): без прав на model кнопки
 * нет, а форма открывается как обычно.
 */

import { ReactNode } from 'react';
import { Badge, Button } from '@mantine/core';
import { useNavigate, useParams } from 'react-router-dom';
import { useSearchCountQuery } from '@/services/api/crudApi';
import type { FilterExpression } from '@/services/api/crudTypes';

interface RelatedRecordsButtonProps {
  /** Модель связанных записей (маршрут списка), например 'sales'. */
  model: string;
  /** Many2one связанной модели на модель формы, например 'partner_id'. */
  field: string;
  label: string;
  icon?: ReactNode;
}

export function RelatedRecordsButton({
  model,
  field,
  label,
  icon,
}: RelatedRecordsButtonProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const filter: FilterExpression = [[field, '=', Number(id)]];
  const { data: count } = useSearchCountQuery({ model, filter }, { skip: !id });

  if (!id || count === undefined) return null;

  // Как «Создать заказ» в тулбаре лида: light с иконкой, число — бейджем
  return (
    <Button
      variant="light"
      leftSection={icon}
      rightSection={
        <Badge size="sm" variant="filled">
          {count}
        </Badge>
      }
      onClick={() =>
        navigate(`/${model}`, { state: { initialFilter: filter } })
      }>
      {label}
    </Button>
  );
}
