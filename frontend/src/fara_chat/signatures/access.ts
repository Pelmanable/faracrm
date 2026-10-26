import type { User } from '@/services/auth/types';

export function canUseSignatures(user: User | null | undefined): boolean {
  return (
    !!user &&
    (user.is_admin || user.role_ids?.some(role => role.code === 'base_user'))
  );
}
