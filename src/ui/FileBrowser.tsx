import { ChevronLeft, Folder, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { FileListing } from './types'

export type SelectedEntry = { name: string; kind: 'folder' | 'file'; path: string }

interface Props {
  listing: FileListing | null
  selected: SelectedEntry | null
  onSelect: (entry: SelectedEntry) => void
  onNavigate: (path: string) => void
}

export default function FileBrowser({ listing, selected, onSelect, onNavigate }: Props) {
  const path = listing?.path ?? ''
  const crumbs = path ? path.split('/') : []
  const parent = crumbs.length > 1 ? crumbs.slice(0, -1).join('/') : crumbs.length === 1 ? '' : null

  return (
    <Card className="flex h-[calc(100vh-10rem)] min-h-[22rem] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {parent !== null && (
            <Button variant="outline" size="xs" onClick={() => onNavigate(parent)}>
              <ChevronLeft data-icon="inline-start" />
              Back
            </Button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('')}
            className="font-mono text-xs text-muted-foreground transition hover:text-foreground"
          >
            files
          </button>
          {crumbs.map((name, i) => (
            <span key={crumbs.slice(0, i + 1).join('/')} className="flex items-center gap-2">
              <span className="text-muted-foreground">/</span>
              <button
                type="button"
                onClick={() => onNavigate(crumbs.slice(0, i + 1).join('/'))}
                className={cn(
                  'font-mono text-xs transition',
                  i === crumbs.length - 1
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {name}
              </button>
            </span>
          ))}
        </div>
        {listing && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {listing.files.length} Items
          </span>
        )}
      </div>

      {!listing ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : listing.files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          No files found.
        </div>
      ) : (
        <ul className="flex-1 divide-y overflow-y-auto">
          {listing.files.map((file) => {
            const isSelected = selected?.path === file.path
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onSelect(file)}
                  onDoubleClick={file.kind === 'folder' ? () => onNavigate(file.path) : undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted/50',
                    isSelected && 'bg-primary/5 text-primary'
                  )}
                >
                  {file.kind === 'folder' ? (
                    <Folder className="size-5 shrink-0 text-primary" />
                  ) : (
                    <FileText className="size-5 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {file.kind}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="border-t bg-muted/30 px-5 py-3 text-[10px] text-muted-foreground">
        Click to select · double-click a folder to open
      </div>
    </Card>
  )
}
