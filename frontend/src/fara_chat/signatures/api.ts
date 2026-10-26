import { crudApi } from '@/services/api/crudApi';

export interface SignatureSetting {
  connector_id: number;
  body: string;
  format: 'text' | 'html';
  auto_insert: boolean;
}

export interface SignatureConnector {
  id: number;
  name: string;
  type: string;
  active: boolean;
}

interface SignatureSettingsResponse {
  data: SignatureSetting[];
  revision: string;
  connectors: SignatureConnector[];
}

interface SaveSignatureArgs {
  userId: number;
  connectorId: number;
  body: string;
  autoInsert: boolean;
  revision: string;
}

const signaturesApi = crudApi
  .enhanceEndpoints({ addTagTypes: ['ChatSignatures'] })
  .injectEndpoints({
    endpoints: build => ({
      // userId разделяет кеш разных сессий; сервер берёт пользователя из сессии.
      getChatSignatures: build.query<SignatureSettingsResponse, number>({
        query: () => ({ url: '/chat/signatures', method: 'GET' }),
        providesTags: (_result, _error, userId) => [
          { type: 'ChatSignatures', id: userId },
        ],
        extraOptions: { silent: true },
      }),
      saveChatSignature: build.mutation<
        Pick<SignatureSettingsResponse, 'data' | 'revision'>,
        SaveSignatureArgs
      >({
        query: ({ connectorId, body, autoInsert, revision }) => ({
          url: `/chat/signatures/${connectorId}`,
          method: 'PUT',
          body: { body, auto_insert: autoInsert, revision },
        }),
        invalidatesTags: (_result, _error, { userId }) => [
          { type: 'ChatSignatures', id: userId },
        ],
        extraOptions: { silent: true },
        async onQueryStarted({ userId }, { dispatch, queryFulfilled }) {
          try {
            const { data } = await queryFulfilled;
            dispatch(
              signaturesApi.util.updateQueryData(
                'getChatSignatures',
                userId,
                draft => {
                  draft.data = data.data;
                  draft.revision = data.revision;
                },
              ),
            );
          } catch {
            // Ошибку сохранения показывает форма настроек.
          }
        },
      }),
    }),
  });

export const { useGetChatSignaturesQuery, useSaveChatSignatureMutation } =
  signaturesApi;
