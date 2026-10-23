import { ActionIcon, Tooltip } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';

/** Белая кнопка-иконка на тёмном фоне окна просмотра. */
export function ToolbarButton({
  label,
  icon: IconComponent,
  onClick,
}: {
  label: string;
  icon: Icon;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant="subtle" color="gray" size="lg" onClick={onClick}>
        <IconComponent size={20} color="white" />
      </ActionIcon>
    </Tooltip>
  );
}
