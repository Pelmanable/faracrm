// Copyright 2025 FARA CRM
// Сводка по звонкам («Всего / Отвечено / Пропущено / Входящие / Исходящие»)
// над таблицей.
//
// Считает БЭК (POST /telephony/calls/stats) по тому же фильтру, что уходит
// в /auto/call/search, но без пагинации: в таблице видна страница, в плашках —
// вся выборка под фильтром.

import { useTranslation } from 'react-i18next';
import { Card, SimpleGrid, Skeleton, Text } from '@mantine/core';
import { useFilters } from '@/components/SearchFilter/FilterContext';
import { mergeFilters } from '@/components/SearchFilter/useFilteredSearchQuery';
import { FilterExpression } from '@/services/api/crudTypes';
import { useGetCallsStatsQuery } from '@/services/api/telephony';

function StatCard({
  label,
  value,
  color,
  loading,
}: {
  label: string;
  value: number;
  color?: string;
  loading: boolean;
}) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {loading ? (
        <Skeleton height={26} width={60} mt={4} />
      ) : (
        <Text size="xl" fw={700} c={color}>
          {value}
        </Text>
      )}
    </Card>
  );
}

export function CallStats({ filter }: { filter?: FilterExpression }) {
  const { t } = useTranslation('chat');
  // Тот же фильтр вью, что подмешивает useFilteredSearchQuery в список —
  // склейка через ту же mergeFilters, чтобы цифры и таблица не разъезжались.
  const contextFilters = useFilters();
  const merged = mergeFilters(filter, contextFilters);

  const { data, isFetching } = useGetCallsStatsQuery({ filter: merged });

  return (
    <SimpleGrid cols={{ base: 2, sm: 5 }} mb="md" px="xs" pt="xs">
      <StatCard
        label={t('calls.total', 'Всего')}
        value={data?.total ?? 0}
        loading={isFetching}
      />
      <StatCard
        label={t('calls.answered', 'Отвечено')}
        value={data?.answered ?? 0}
        color="green"
        loading={isFetching}
      />
      <StatCard
        label={t('calls.missed', 'Пропущено')}
        value={data?.missed ?? 0}
        color="red"
        loading={isFetching}
      />
      <StatCard
        label={t('calls.incomingPlural', 'Входящие')}
        value={data?.incoming ?? 0}
        color="blue"
        loading={isFetching}
      />
      <StatCard
        label={t('calls.outgoingPlural', 'Исходящие')}
        value={data?.outgoing ?? 0}
        color="violet"
        loading={isFetching}
      />
    </SimpleGrid>
  );
}

export default CallStats;
