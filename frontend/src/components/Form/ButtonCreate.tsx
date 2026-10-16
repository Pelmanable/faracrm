import { Button } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { FormFieldsContext, useFormContext } from './FormContext';
import { useCreateMutation } from '@/services/api/crudApi';
import { UseFormReturnType } from '@mantine/form';
import { FaraRecord, VirtualId } from '@/services/api/crudTypes';
import { useContext } from 'react';
import { prepareValuesToSave } from './utils';
import { useTranslation } from 'react-i18next';
import { useRequiredFieldsCheck } from './hooks/useRequiredFieldsCheck';
// import { useDispatch } from 'react-redux';

export function ButtonCreate({
  model,
  parentFieldName,
  parentForm,
  parentId,
  relatedFieldO2M,
  modalClose,
  onCreated,
}: {
  model: string;
  parentFieldName?: string;
  parentForm?: UseFormReturnType<FaraRecord>;
  parentId?: number;
  relatedFieldO2M?: string;
  modalClose?: () => void;
  /**
   * Если задан — форма работает в режиме «создать и вернуть» (быстрое
   * создание Many2one из попапа): после реального create вызываем onCreated
   * с созданной записью и закрываем модалку, НЕ переходя на её форму.
   * Без onCreated поведение прежнее (reset + navigate на новую запись).
   */
  onCreated?: (record: FaraRecord) => void;
}) {
  const { fields: fieldsServer } = useContext(FormFieldsContext);
  const { t } = useTranslation('common');
  const form = useFormContext();
  const navigate = useNavigate();
  // const dispatch = useDispatch();
  const [create, { isLoading }] = useCreateMutation();
  const checkRequired = useRequiredFieldsCheck();
  return (
    <Button
      loading={isLoading}
      variant="filled"
      onClick={async () => {
        // Валидация обязательных полей
        if (!checkRequired()) {
          return; // Прерываем создание если есть ошибки
        }

        // ONE2MANY
        // если создание происходит из O2M и поле не задано, то
        // необходимо добавить ид родителя для свзяи
        if (relatedFieldO2M)
          if (parentId) form.setValues({ [relatedFieldO2M]: parentId });
          // при создании записи, еще нет ид из бд
          // но при этом необходимо сделать связи в связанных таблицах
          // поэтому используется статическое значение виртуальный ид
          // else form.setValues({ [relatedFieldO2M]: { id: VirtualId } });
          else form.setValues({ [relatedFieldO2M]: VirtualId });

        const values = form.getValues();
        // добавить текущую форму в родительское поле O2M
        if (parentFieldName && parentForm && modalClose) {
          // если форма является вложенной в другую,
          // например это форма вызванная из m2m или o2m
          // как модальное окно, то не надо делать запрос в базу
          // просто локально необходимо сохранить новые данные в форму
          // для жтого используется тоде имя с префиксом _
          const parentFormName = '_' + parentFieldName;
          // вообще этот компонент не должен делать логику сохранения
          // прошлых значений вместо этого он должен просто передать новое
          // необходимо перенести код позже
          const oldSource = parentForm.getValues()[parentFieldName];
          // ButtonUpdate после успешного Save выставляет form._<field> в
          // null (чтобы Mantine v8 setValues, который МЕРЖИТ, реально
          // затёр patch, а не сохранил его). Поэтому простого
          // `in form` мало — ключ есть, но значение null. Проверяем
          // truthy + наличие created/deleted, иначе берём свежий каркас.
          const rawOld = parentForm.getValues()[parentFormName];
          const old =
            rawOld && typeof rawOld === 'object'
              ? {
                  created: rawOld.created || [],
                  deleted: rawOld.deleted || [],
                }
              : { created: [], deleted: [] };
          // добавляем новую строку в родительское скрытое поле
          let virtualId = (oldSource?.total || 0) + old.created.length;
          values['_color'] = 'new';
          values['id'] = 'virtual' + virtualId.toString();

          parentForm.setValues({
            [parentFormName]: {
              deleted: old.deleted,
              created: [...old.created, values],
              fieldsServer: fieldsServer,
            },
          });

          modalClose();
        } else {
          // необходимо найти все o2m и m2m и их _
          // найти все created и заменить на values
          // const valuesCreate: Omit<FaraRecord, 'id'> = {};
          // for (let [fieldName, fieldValue] of Object.entries(values)) {
          //   if (fieldName.startsWith('_'))
          //     valuesCreate[fieldName.substring(1)] = fieldValue;
          //   else if (!('_' + fieldName in values)) {
          //     valuesCreate[fieldName] = fieldValue;
          //   }
          // }
          // console.log(valuesCreate, 'valuesCreate');
          const valuesToCreate = structuredClone(form.getValues());

          // Отправляем только заданные пользователем поля (изменённые
          // относительно дефолтов; baseline — default_values, см. Form.tsx).
          // Незатронутые поля бэкенд заполнит дефолтами сам. `_*` (команды
          // O2M/M2M) — change-based, оставляем. Так restricted-поля
          // (is_admin/role_ids), которых пользователь не трогал, не уходят на
          // бэк и не упираются в field-level проверку (presence-based).
          for (const key of Object.keys(valuesToCreate)) {
            if (key === 'id' || key.startsWith('_')) continue;
            // Required-поля оставляем всегда (lang_id и т.п.) — схема create
            // их требует, иначе 422. Неизменённый is_admin (не required, не
            // dirty) дропается → не уходит на бэк → system_admin тоже сможет
            // создавать юзеров без блокировки field-level проверкой.
            if (fieldsServer[key]?.required) continue;
            if (!form.isDirty(key)) delete valuesToCreate[key];
          }

          // ВАЖНО: собираем pending O2M-изменения ДО prepareValuesToSave.
          // prepareValuesToSave мигрирует `_contact_ids` → `contact_ids`
          // и удаляет служебный префиксный ключ. Используется FieldContacts
          // когда родителя ещё нет — вместо немедленного API-вызова
          // изменения складываются в `_<fieldName>` со структурой
          // { created, deleted, relatedField }. После create родителя
          // ниже мы создадим дочерние записи с актуальным id родителя.
          const pendingO2m: {
            fieldName: string;
            created: any[];
            relatedField: string;
          }[] = [];
          for (const [key, val] of Object.entries(valuesToCreate)) {
            if (
              key.startsWith('_') &&
              val &&
              typeof val === 'object' &&
              'created' in val &&
              'relatedField' in val
            ) {
              pendingO2m.push({
                fieldName: key.slice(1),
                created: (val as any).created || [],
                relatedField: (val as any).relatedField,
              });
              // Удаляем служебное поле — иначе prepareValuesToSave
              // перенесёт его в настоящий contact_ids в payload и бэк
              // получит лишние данные.
              delete (valuesToCreate as any)[key];
            }
          }

          prepareValuesToSave(fieldsServer, valuesToCreate);

          const { data } = await create({
            model,
            values: valuesToCreate,
          });

          if (data?.id) {
            // Создаём отложенные дочерние записи с актуальным id родителя.
            for (const { fieldName, created: createdItems, relatedField } of pendingO2m) {
              const childModel =
                fieldsServer[fieldName]?.relatedModel || 'contact';
              for (const item of createdItems) {
                await create({
                  model: childModel,
                  values: { ...item, [relatedField]: data.id },
                });
              }
            }

            if (onCreated) {
              // Режим «создать и вернуть» (попап быстрого создания M2O):
              // отдаём созданную запись вызывающему полю (оно подставит её
              // значением) и закрываем модалку. valuesToCreate уже прошёл
              // prepareValuesToSave (id удалён, M2O → числа), поэтому
              // разворачиваем его поверх id — для отображения хватит name.
              onCreated({ ...valuesToCreate, id: data.id });
              modalClose?.();
            } else {
              form.reset();
              navigate(`/${model}/${data?.id}`);
            }
          }
          // НЕ переходим на список при ошибке. RTK Query вернул { error }
          // (например, бэк отдал 400 при нарушении бизнес-инварианта —
          // дубликат login и подобное). Глобальный обработчик в
          // baseQueryWithReauth уже показал ApiErrorModal — здесь нам
          // важно сохранить состояние формы, чтобы пользователь
          // подправил поле и нажал «Создать» ещё раз без потери ввода.
        }
      }}>
      {parentFieldName && parentForm ? t('add') : t('create')}
    </Button>
  );
}
