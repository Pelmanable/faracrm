import { Button } from '@mantine/core';
import { FormFieldsContext, useFormContext } from './FormContext';
import { useUpdateMutation, crudApi } from '@/services/api/crudApi';
import { useDispatch } from 'react-redux';
import { Identifier } from '@/services/api/crudTypes';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { prepareValuesToSave } from './utils';
import { useRequiredFieldsCheck } from './hooks/useRequiredFieldsCheck';

export function ButtonUpdate({
  model,
  id,
  // fields,
  onSaveSuccess,
}: {
  model: string;
  id: Identifier;
  // fields: Field[];
  parentId?: number;
  relatedFieldO2M?: string;
  onSaveSuccess?: () => void;
}) {
  const { t } = useTranslation('common');
  const { fields: fieldsServer } = useContext(FormFieldsContext);
  const form = useFormContext();
  const [update] = useUpdateMutation();
  const dispatch = useDispatch();
  const [saving, setSaving] = useState(false);
  const checkRequired = useRequiredFieldsCheck();

  const handleSave = async () => {
    // Валидация обязательных полей
    if (!checkRequired()) {
      return;
    }

    setSaving(true);

    try {
      const values = structuredClone(form.getValues());

      // Отправляем только реально изменённые поля. Скаляры/M2O — по
      // dirty-флагу Mantine (baseline задан resetDirty при загрузке записи,
      // см. Form.tsx). Ключи `_*` (команды M2M/O2M) уже change-based —
      // присутствуют только при правках, оставляем как есть. Так
      // restricted-поля (is_admin/role_ids), которых пользователь не менял,
      // не уходят на бэк и не упираются в field-level проверку
      // (presence-based на сервере).
      for (const key of Object.keys(values)) {
        if (key === 'id' || key.startsWith('_')) continue;
        // Required-поля оставляем всегда (схема требует их → иначе 422 и
        // фронтовая валидация). Они не restricted (is_admin/role_ids не
        // required), так что field-level проверка не ослабляется.
        if (fieldsServer[key]?.required) continue;
        if (!form.isDirty(key)) delete values[key];
      }

      // Собираем имена M2M/O2M полей с изменениями для инвалидации кеша
      const invalidateTags: string[] = [];
      // Связанные модели O2M/M2M, чьи данные пересчитал бэкенд
      // (через @depends) — их список нужно перезапросить после save.
      const relatedModelsToRefetch = new Set<string>();
      for (const key of Object.keys(values)) {
        if (key.startsWith('_')) {
          const v = values[key];
          const hasChanges =
            v?.unselected?.length ||
            v?.created?.length ||
            v?.selected?.length ||
            v?.deleted?.length ||
            (v?.updated && Object.keys(v.updated).length);
          if (hasChanges) {
            const fieldName = key.slice(1); // '_role_ids' -> 'role_ids'
            invalidateTags.push(fieldName);
            const rel = fieldsServer[fieldName]?.relatedModel;
            if (rel) relatedModelsToRefetch.add(rel);
          }
        }
      }

      prepareValuesToSave(fieldsServer, values);

      await update({
        model,
        id,
        values,
        invalidateTags,
      });

      // После сохранения бэкенд пересчитал зависимые поля строк
      // (price_subtotal/price_total и др. через @depends). Кэш
      // связанной модели при сохранении родителя автоматически НЕ
      // инвалидируется — делаем это вручную, чтобы O2M перезапросил
      // строки и показал пересчитанные значения, а не старые.
      if (relatedModelsToRefetch.size) {
        dispatch(
          crudApi.util.invalidateTags(
            [...relatedModelsToRefetch].map(
              m => ({ type: m, id: 'LIST' }) as any,
            ),
          ),
        );
      }

      // Все `_*` патчи (O2M/M2M command-dict'ы вида
      // _order_line_ids = {created/updated/deleted/unselected/selected})
      // уже отправлены и применены на сервере. Держать их дальше в форме
      // нельзя:
      //   1) FieldOne2many читает form['_name'] для синхронизации
      //      recordsCreated — без зачистки virtual-строки возвращаются
      //      на следующий ре-рендер.
      //   2) Повторное нажатие Save без новых правок отправило бы те же
      //      команды второй раз.
      //
      // ВАЖНО: Mantine v8 `form.setValues` МЕРЖИТ, а не заменяет — попытка
      // `delete cleaned[key]` + setValues(cleaned) бесполезна, Mantine
      // допишет старые `_*` обратно из текущего состояния. Поэтому каждый
      // `_*` ключ явно ставим в null — это значение, которое реально
      // запишется и затрёт patch (FieldOne2many трактует null/undefined
      // одинаково через `patch?.created || []`).
      const reset: Record<string, any> = {};
      for (const key of Object.keys(form.getValues())) {
        if (key.startsWith('_')) {
          reset[key] = null;
        }
      }
      if (Object.keys(reset).length) {
        form.setValues(reset);
      }

      // Baseline для dirty — АКТУАЛЬНОЕ состояние формы после
      // setValues(reset), включая `_*: null`. Иначе Mantine посчитает
      // форму грязной (null в form vs отсутствие ключа в baseline) и
      // кнопка Save не погаснет.
      form.resetDirty(form.getValues());
      onSaveSuccess?.();
    } catch (error) {
      // TODO: показать ошибку
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button loading={saving} variant="filled" onClick={handleSave}>
      {saving ? t('saving') : t('save')}
    </Button>
  );
}
