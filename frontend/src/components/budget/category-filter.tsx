'use client'

import { Button } from "@/components/ui/button"

interface CategoryFilterProps {
  categories: string[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
}

export function CategoryFilter({ categories, selected, onChange }: CategoryFilterProps) {
  const allSelected = categories.length > 0 && selected.size === categories.length

  function toggleCategory(category: string) {
    const next = new Set(selected)
    if (next.has(category)) {
      next.delete(category)
    } else {
      next.add(category)
    }
    onChange(next)
  }

  function toggleAll() {
    if (allSelected) {
      onChange(new Set())
    } else {
      onChange(new Set(categories))
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        variant={allSelected ? "default" : "outline"}
        size="xs"
        onClick={toggleAll}
      >
        {allSelected ? "全解除" : "全選択"}
      </Button>
      {categories.map((cat) => (
        <Button
          key={cat}
          variant={selected.has(cat) ? "secondary" : "outline"}
          size="xs"
          onClick={() => toggleCategory(cat)}
        >
          {cat}
        </Button>
      ))}
    </div>
  )
}
