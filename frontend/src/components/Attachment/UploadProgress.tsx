import { Progress, Stack, Text } from '@mantine/core';

/** Полоса загрузки файла (useUploadFile) с процентом. */
export function UploadProgress({ value }: { value: number }) {
  return (
    <Stack gap={4} w="100%" maw={300} align="center">
      <Progress value={value} w="100%" animated />
      <Text size="xs" c="dimmed">
        {Math.round(value)}%
      </Text>
    </Stack>
  );
}
