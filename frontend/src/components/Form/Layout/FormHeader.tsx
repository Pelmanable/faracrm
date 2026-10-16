import { ReactNode } from 'react';
import { Stack, Box, Paper, Title, Text } from '@mantine/core';
import classes from './FormLayout.module.css';
import { useExtensions } from '@/shared/extensions';

interface FormHeaderProps {
  children: ReactNode;
  avatar?: ReactNode; // Field для аватара/изображения
  title?: string | ReactNode;
  subtitle?: string | ReactNode;
  actions?: ReactNode;
}

/**
 * Шапка формы с заголовком (с рамкой)
 *
 * @example
 * <FormHeader title="Настройки пользователя">
 *   <Field name="name" />
 * </FormHeader>
 *
 * @example
 * <FormHeader
 *   title={<ContractHeaderSummary />}
 *   actions={<Field name="sale_ids" widget="x2mButton" ... />}
 * />
 */
export function FormHeader({
  children,
  avatar,
  title,
  subtitle,
  actions,
}: FormHeaderProps) {
  return (
    <Paper
      className={classes.headerPaper}
      withBorder
      p={{ base: 'sm', sm: 'md' }}
      radius="md">
      <Box className={classes.headerGroup}>
        {avatar && <Box className={classes.headerAvatar}>{avatar}</Box>}

        <Stack gap="sm" className={classes.headerContent}>
          {(title || subtitle) && (
            <Box mb="xs">
              {title &&
                (typeof title === 'string' ? (
                  <Title order={4}>{title}</Title>
                ) : (
                  title
                ))}
              {subtitle &&
                (typeof subtitle === 'string' ? (
                  <Text size="sm" c="dimmed">
                    {subtitle}
                  </Text>
                ) : (
                  subtitle
                ))}
            </Box>
          )}
          {children}
        </Stack>

        {/* RIGHT-pinned actions slot: ml=auto не трогает позиции
            avatar/Stack, просто прижимает себя к правому краю. */}
        {actions && <Box ml="auto">{actions}</Box>}
      </Box>
    </Paper>
  );
}

interface FormSheetProps {
  children: ReactNode;
  avatar?: ReactNode;
}

/**
 * Основной блок формы с аватаром (без рамки)
 */
export function FormSheet({ children, avatar }: FormSheetProps) {
  // Получаем расширения для позиции after:FormSheet
  const extensionsAfter = useExtensions('after:FormSheet');

  return (
    <>
      <Box className={classes.sheetContainer}>
        <Box className={classes.sheetGroup}>
          {avatar && <Box className={classes.sheetAvatar}>{avatar}</Box>}

          <Stack gap="sm" className={classes.sheetContent}>
            {children}
          </Stack>
        </Box>
      </Box>

      {/* Расширения после FormSheet */}
      {extensionsAfter.map((Ext, i) => (
        <Ext key={i} />
      ))}
    </>
  );
}

interface FormAvatarFieldProps {
  children: ReactNode; // Field для изображения
  size?: number;
}

/**
 * Обёртка для поля аватара
 */
export function FormAvatarField({
  children,
  size = 120,
}: FormAvatarFieldProps) {
  return (
    <Box className={classes.avatarField} style={{ width: size }}>
      {children}
    </Box>
  );
}

FormHeader.displayName = 'FormHeader';
FormSheet.displayName = 'FormSheet';
FormAvatarField.displayName = 'FormAvatarField';
