import { useTranslation } from 'react-i18next';
import { List } from '@/components/List/List';
import { Field } from '@/components/List/Field';
import { ViewListProps } from '@/route/type';
import RelationCell from '@/components/ListCells/RelationCell';
import DateTimeCell from '@/components/ListCells/DateTimeCell';

export function ViewListMarketingVideo(props: ViewListProps) {
  const { t } = useTranslation('marketing');

  return (
    <List model="marketing_video" {...props}>
      <Field name="id" label={t('fields.id')} />
      <Field name="name" label={t('fields.name')} />
      <Field name="caption" label={t('fields.caption')} />
    </List>
  );
}

export function ViewListMarketingChannel(props: ViewListProps) {
  const { t } = useTranslation('marketing');

  return (
    <List model="marketing_channel" {...props}>
      <Field name="id" label={t('fields.id')} />
      <Field name="name" label={t('fields.name')} />
      <Field name="type" label={t('fields.type')} />
      <Field
        name="connector_id"
        label={t('fields.connector_id')}
        render={value => <RelationCell value={value} model="chat_connector" />}
      />
      <Field name="chat_id" label={t('fields.chat_id')} />
    </List>
  );
}

export function ViewListMarketingPublication(props: ViewListProps) {
  const { t } = useTranslation('marketing');

  return (
    <List
      model="marketing_publication"
      order="desc"
      sort="date_planned"
      {...props}>
      <Field name="id" label={t('fields.id')} />
      <Field
        name="date_planned"
        label={t('fields.date_planned')}
        render={value => <DateTimeCell value={value} format="compact" />}
      />
      <Field
        name="video_id"
        label={t('fields.video_id')}
        render={value => <RelationCell value={value} model="marketing_video" />}
      />
      <Field
        name="channel_id"
        label={t('fields.channel_id')}
        render={value => (
          <RelationCell value={value} model="marketing_channel" />
        )}
      />
      <Field name="kind" label={t('fields.kind')} />
      <Field name="state" label={t('fields.state')} />
      <Field
        name="date_done"
        label={t('fields.date_done')}
        render={value => <DateTimeCell value={value} format="compact" />}
      />
      <Field name="error" label={t('fields.error')} />
    </List>
  );
}

export function ViewListMarketingRule(props: ViewListProps) {
  const { t } = useTranslation('marketing');

  return (
    <List model="marketing_rule" {...props}>
      <Field name="id" label={t('fields.id')} />
      <Field name="name" label={t('fields.name')} />
      <Field name="kind" label={t('fields.kind')} />
      <Field name="interval_number" label={t('fields.interval_number')} />
      <Field name="interval_type" label={t('fields.interval_type')} />
      <Field
        name="date_next"
        label={t('fields.date_next')}
        render={value => <DateTimeCell value={value} format="compact" />}
      />
      <Field name="active" label={t('fields.active')} />
    </List>
  );
}
