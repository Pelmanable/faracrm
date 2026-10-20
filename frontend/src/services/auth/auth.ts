import { baseQuery } from '@services/baseQueryWithReauth';
import { createApi } from '@reduxjs/toolkit/query/react';
import type { Session, UserInput } from './types';
import { notifyAuthChange } from './authChannel';

// const baseQuery = fetchBaseQuery({
//   baseUrl: '/',
//   prepareHeaders: headers => {
//     headers.set('Content-Type', 'application/json');
//     headers.set('Accept', 'application/json');
//     return headers;
//   },
//   // Example: we have a backend API always returns a 200,
//   // but sets an `isError` property when there is an error.
//   validateStatus: (response, result) =>
//     response.status === 200 && !result.error,
// });

export const authApi = createApi({
  reducerPath: 'authApi',
  baseQuery,
  endpoints: builder => ({
    login: builder.mutation<Session, UserInput>({
      query: props => ({
        url: '/signin',
        method: 'POST',
        // credentials: 'omit',
        body: {
          login: props.login,
          password: props.password,
        },
      }),
      // Вход руками (SignIn, Register): остальные вкладки подхватят сессию,
      // когда на них переключатся (Layout). Неудачный вход — молчим.
      async onQueryStarted(_, { queryFulfilled }) {
        try {
          await queryFulfilled;
          notifyAuthChange();
        } catch {
          // неверный пароль и т.п. — сообщать соседям нечего
        }
      },
    }),

    logout: builder.mutation<void, void>({
      query: () => ({
        url: '/sessions/logout',
        method: 'POST',
      }),
      // Выход руками (кнопка «Выйти»): на сервер идёт только эта вкладка,
      // остальные выходят у себя, без запросов (Layout).
      onQueryStarted() {
        notifyAuthChange();
      },
    }),
  }),
});

export const { useLoginMutation, useLogoutMutation } = authApi;
