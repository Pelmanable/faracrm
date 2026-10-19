import { useTranslation } from 'react-i18next';
import { Form } from '@/components/Form/Form';
import { Field } from '@/components/List/Field';
import { ViewFormProps } from '@/route/type';
import { FormSection, FormRow } from '@/components/Form/Layout';
import {
  IconBrandTelegram,
  IconCalendarEvent,
  IconPlugConnected,
  IconRepeat,
  IconSend,
  IconVideo,
} from '@tabler/icons-react';
import { ConnectButton } from './components/ConnectButton';
import { TelegramLoginButton } from './components/TelegramLoginButton';
import { RutubeLoginButton } from './components/RutubeLoginButton';

// Облачный Bot API Telegram принимает файлы до 50 МБ
const VIDEO_MAX_SIZE = 50 * 1024 * 1024;

export function ViewFormMarketingVideo(props: ViewFormProps) {
  const { t } = useTranslation('marketing');

  return (
    <Form model="marketing_video" {...props}>
      <FormSection title={t('sections.video')} icon={<IconVideo size={18} />}>
        <Field name="name" label={t('fields.name')} />
        <Field
          name="file"
          label={t('fields.file')}
          accept="video/*"
          maxSize={VIDEO_MAX_SIZE}
        />
        <Field name="caption" label={t('fields.caption')} />
      </FormSection>
      <FormSection
        title={t('sections.video_publications')}
        icon={<IconSend size={18} />}>
        <Field name="publication_ids" label={t('fields.publication_ids')}>
          <Field name="id" />
          <Field name="channel_id" />
          <Field name="kind" />
          <Field name="state" />
          <Field name="date_planned" />
          <Field name="date_done" />
          <Field name="url" />
          <Field name="error" />
        </Field>
      </FormSection>
    </Form>
  );
}

export function ViewFormMarketingChannel(props: ViewFormProps) {
  const { t } = useTranslation('marketing');

  return (
    <Form
      model="marketing_channel"
      actions={
        <>
          <ConnectButton />
          <TelegramLoginButton />
          <RutubeLoginButton />
        </>
      }
      {...props}>
      <FormSection title={t('sections.channel')} icon={<IconSend size={18} />}>
        <FormRow cols={2}>
          <Field name="name" label={t('fields.name')} />
          <Field name="type" label={t('fields.type')} />
        </FormRow>
      </FormSection>
      <FormSection
        title={t('sections.chat')}
        icon={<IconBrandTelegram size={18} />}>
        <FormRow cols={2}>
          <Field
            name="connector_id"
            label={t('fields.connector_id')}
            description={t('hints.connector_id')}
            filter={[['marketing', '=', true]]}
          />
          <Field
            name="chat_id"
            label={t('fields.chat_id')}
            description={t('hints.chat_id')}
          />
        </FormRow>
      </FormSection>
      <FormSection
        title={t('sections.oauth')}
        icon={<IconPlugConnected size={18} />}>
        <FormRow cols={2}>
          <Field
            name="client_id"
            label={t('fields.client_id')}
            description={t('hints.client_id')}
          />
          <Field name="client_secret" label={t('fields.client_secret')} />
        </FormRow>
        <FormRow cols={2}>
          <Field
            name="proxy_url"
            label={t('fields.proxy_url')}
            description={t('hints.proxy_url')}
          />
          <Field name="authorized" label={t('fields.authorized')} />
        </FormRow>
      </FormSection>
    </Form>
  );
}

export function ViewFormMarketingPublication(props: ViewFormProps) {
  const { t } = useTranslation('marketing');

  return (
    <Form model="marketing_publication" {...props}>
      <FormSection
        title={t('sections.publication')}
        icon={<IconSend size={18} />}>
        <FormRow cols={2}>
          <Field name="video_id" label={t('fields.video_id')} />
          <Field name="channel_id" label={t('fields.channel_id')} />
        </FormRow>
        <FormRow cols={2}>
          <Field name="kind" label={t('fields.kind')} />
          <Field name="date_planned" label={t('fields.date_planned')} />
        </FormRow>
        <FormRow cols={2}>
          <Field name="state" label={t('fields.state')} />
          <Field name="rule_id" label={t('fields.rule_id')} />
        </FormRow>
        <FormRow cols={2}>
          <Field name="date_done" label={t('fields.date_done')} />
          <Field name="url" label={t('fields.url')} widget="charUrl" />
        </FormRow>
        <Field name="error" label={t('fields.error')} />
      </FormSection>
    </Form>
  );
}

export function ViewFormMarketingRule(props: ViewFormProps) {
  const { t } = useTranslation('marketing');

  return (
    <Form model="marketing_rule" {...props}>
      <FormSection title={t('sections.rule')} icon={<IconRepeat size={18} />}>
        <FormRow cols={2}>
          <Field name="name" label={t('fields.name')} />
          <Field name="kind" label={t('fields.kind')} />
        </FormRow>
        <Field name="active" label={t('fields.active')} />
        <Field name="video_ids" label={t('fields.video_ids')}>
          <Field name="id" />
          <Field name="name" />
        </Field>
        <Field name="channel_ids" label={t('fields.channel_ids')}>
          <Field name="id" />
          <Field name="name" />
        </Field>
      </FormSection>
      <FormSection
        title={t('sections.schedule')}
        icon={<IconCalendarEvent size={18} />}>
        <FormRow cols={2}>
          <Field name="interval_number" label={t('fields.interval_number')} />
          <Field name="interval_type" label={t('fields.interval_type')} />
        </FormRow>
        <FormRow cols={2}>
          <Field name="date_next" label={t('fields.date_next')} />
          <Field name="last_video_id" label={t('fields.last_video_id')} />
        </FormRow>
      </FormSection>
    </Form>
  );
}
