import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { notifications } from '@mantine/notifications';
import { FormFieldsContext, useFormContext } from '../FormContext';
import { fieldLabel } from '../fieldLabel';

/** Пусто ли значение обязательного поля (Many2one — объект без id). */
const isEmpty = (value: any, type: string): boolean =>
  value === null ||
  value === undefined ||
  value === '' ||
  (type === 'Many2one' && typeof value === 'object' && !value.id);

/**
 * Проверка обязательных полей перед «Создать»/«Сохранить». Ошибка
 * ставится под самим полем, а список незаполненных — в уведомление: поле
 * может быть на закрытой вкладке или в зоне студии, и без списка не видно,
 * почему запись не сохраняется.
 * @returns функцию проверки: true — можно сохранять
 */
export function useRequiredFieldsCheck() {
  const { t } = useTranslation('common');
  const form = useFormContext();
  const { model, fields, labels } = useContext(FormFieldsContext);

  return () => {
    const values = form.getValues();
    const missing: string[] = [];

    for (const [name, info] of Object.entries(fields)) {
      if (!info.required) continue;
      const empty = isEmpty(values[name], info.type);
      form.setFieldError(name, empty ? t('requiredField') : null);
      // Подпись из разметки, у полей студии — из модели
      if (empty) missing.push(labels?.[name] ?? fieldLabel(t, model, info));
    }

    if (missing.length) {
      notifications.show({
        color: 'red',
        title: t('requiredFieldsTitle'),
        message: missing.join(', '),
      });
    }
    return !missing.length;
  };
}
