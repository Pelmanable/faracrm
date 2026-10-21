import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Session } from '@services/auth/types';
import { RootState } from '@store/store';

type AuthState = {
  session?: Session;
};

function loadSession(): Session | undefined {
  try {
    const raw = localStorage.getItem('session');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    // Проверяем что это валидная сессия, а не пустой объект
    return parsed?.token ? (parsed as Session) : undefined;
  } catch {
    return undefined;
  }
}

const initialState: AuthState = {
  session: loadSession(),
};

const slice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    storeSession: (
      state,
      { payload: { session } }: PayloadAction<{ session: Session }>,
    ) => {
      localStorage.setItem('session', JSON.stringify(session));
      state.session = session;
    },

    logOut: () => {
      localStorage.clear();
      return { session: undefined };
    },
  },
});

export const { storeSession, logOut } = slice.actions;

export default slice.reducer;

export const selectCurrentSession = (state: RootState) => state.auth.session;
export const selectIsLoggedIn = (state: RootState) => state.auth.session?.token;
