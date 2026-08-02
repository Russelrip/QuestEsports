import { ReactNode, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { DetailModal, type RecordAction } from "@/components/DetailModal";
import { Card, EmptyState, ErrorNotice, Field, FilterPills, PageHeader, Screen, StatusBadge } from "@/components/ui";
import { useResource } from "@/hooks/useResource";
import { colors, spacing } from "@/theme";

export type ListCard = {
  title: string;
  subtitle?: string;
  status?: string;
  secondaryStatus?: string;
  meta?: string[];
  trailing?: ReactNode;
};

type Props<T extends { id: string }> = {
  title: string;
  subtitle: string;
  endpoint: string;
  responseKey: string;
  filters?: Array<{ label: string; value: string }>;
  filterKey?: string;
  mapCard: (item: T) => ListCard;
  detailPath?: (item: T) => string;
  detailKey?: string;
  actions?: (item: T, detail: Record<string, unknown>) => RecordAction[];
  transform?: (value: unknown) => T[];
};

export function OperationsScreen<T extends { id: string }>({
  title,
  subtitle,
  endpoint,
  responseKey,
  filters = [{ label: "All", value: "" }],
  filterKey,
  mapCard,
  detailPath,
  detailKey,
  actions,
  transform,
}: Props<T>) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<T | null>(null);
  const resource = useResource<T>({
    endpoint,
    responseKey,
    search,
    filterKey,
    filterValue: filter,
    transform,
  });

  return (
    <Screen>
      <PageHeader
        title={title}
        subtitle={resource.pagination ? `${resource.pagination.total} records · ${subtitle}` : subtitle}
      />
      <View style={styles.searchWrap}>
        <Field value={search} onChangeText={setSearch} placeholder={`Search ${title.toLowerCase()}`} autoCapitalize="none" returnKeyType="search" />
      </View>
      {filters.length > 1 ? <FilterPills values={filters} selected={filter} onSelect={setFilter} /> : null}
      {resource.error ? <ErrorNotice message={resource.error} retry={resource.reload} /> : null}
      {resource.loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={resource.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, !resource.items.length && styles.emptyList]}
          refreshing={resource.refreshing}
          onRefresh={resource.reload}
          renderItem={({ item }) => {
            const card = mapCard(item);
            return (
              <Card onPress={() => setSelected(item)}>
                <View style={styles.cardTop}>
                  <View style={styles.cardText}>
                    <Text style={styles.cardTitle}>{card.title}</Text>
                    {card.subtitle ? <Text style={styles.cardSubtitle}>{card.subtitle}</Text> : null}
                  </View>
                  {card.trailing}
                </View>
                <View style={styles.badges}>
                  {card.status ? <StatusBadge value={card.status} /> : null}
                  {card.secondaryStatus ? <StatusBadge value={card.secondaryStatus} /> : null}
                </View>
                {card.meta?.map((line) => <Text key={line} style={styles.meta}>{line}</Text>)}
              </Card>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={<EmptyState title={`No ${title.toLowerCase()}`} message="No records match the current filters." />}
        />
      )}
      <DetailModal
        visible={Boolean(selected)}
        item={selected}
        title={(item) => mapCard(item).title}
        detailPath={detailPath}
        detailKey={detailKey}
        actions={actions}
        onClose={() => setSelected(null)}
        onChanged={resource.reload}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.md, paddingTop: spacing.sm, paddingBottom: 100 },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  separator: { height: spacing.sm },
  cardTop: { flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  cardText: { flex: 1 },
  cardTitle: { color: colors.text, fontWeight: "800", fontSize: 17 },
  cardSubtitle: { color: colors.muted, marginTop: 2, fontSize: 13 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  meta: { color: colors.muted, fontSize: 12 },
});
