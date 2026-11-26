type TreeSection = { id: number; parentId: number | null; position: number; title: string }
type TreeItem = { id: number; sectionId: number; position: number }

/** セクションの中の並びの 1 つ。サブセクションは、中のアイテムを持つ */
export type TreeEntry<S, I> = { kind: 'item'; item: I } | { kind: 'section'; section: S; items: I[] }

export type TopSection<S, I> = { section: S; entries: TreeEntry<S, I>[] }

const entryPosition = <S extends TreeSection, I extends TreeItem>(e: TreeEntry<S, I>) =>
  e.kind === 'item' ? e.item.position : e.section.position

const entryRank = <S extends TreeSection, I extends TreeItem>(e: TreeEntry<S, I>) => (e.kind === 'item' ? 0 : 1)

const entryId = <S extends TreeSection, I extends TreeItem>(e: TreeEntry<S, I>) => (e.kind === 'item' ? e.item.id : e.section.id)

/** sections と items は、それぞれ position・id の順に並んでいるものを渡す */
export function sectionTree<S extends TreeSection, I extends TreeItem>(sections: S[], items: I[]): TopSection<S, I>[] {
  const bySection = new Map<number, I[]>()
  for (const it of items) bySection.set(it.sectionId, [...(bySection.get(it.sectionId) ?? []), it])
  const children = new Map<number, S[]>()
  for (const s of sections) if (s.parentId) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s])
  return sections
    .filter((s) => !s.parentId)
    .map((section) => ({
      section,
      entries: [
        ...(bySection.get(section.id) ?? []).map((item): TreeEntry<S, I> => ({ kind: 'item', item })),
        ...(children.get(section.id) ?? []).map((sub): TreeEntry<S, I> => ({
          kind: 'section',
          section: sub,
          items: bySection.get(sub.id) ?? [],
        })),
      ].sort((a, b) => entryPosition(a) - entryPosition(b) || entryRank(a) - entryRank(b) || entryId(a) - entryId(b)),
    }))
}

/** セクションの中のアイテム。サブセクションの中のものも、並びの順に含む */
export const entryItems = <S extends TreeSection, I extends TreeItem>(entries: TreeEntry<S, I>[]) =>
  entries.flatMap((e) => (e.kind === 'item' ? [e.item] : e.items))

/** コースのアイテムを、画面に並べる順に */
export const treeItems = <S extends TreeSection, I extends TreeItem>(tree: TopSection<S, I>[]) => tree.flatMap((t) => entryItems(t.entries))

/** セクションの選択肢。サブセクションは親の直後に「親 › 子」で並べる */
export const sectionOptions = <S extends TreeSection>(sections: S[]) =>
  sectionTree(sections, []).flatMap(({ section, entries }) => [
    { value: String(section.id), label: section.title },
    ...entries.flatMap((e) =>
      e.kind === 'section' ? [{ value: String(e.section.id), label: `${section.title} › ${e.section.title}` }] : [],
    ),
  ])

/** サブセクションなら「親 › 子」、そうでなければセクション名 */
export function sectionLabel<S extends TreeSection>(sections: S[], sectionId: number) {
  const section = sections.find((s) => s.id === sectionId)
  const parent = section?.parentId ? sections.find((s) => s.id === section.parentId) : undefined
  return section ? (parent ? `${parent.title} › ${section.title}` : section.title) : ''
}
