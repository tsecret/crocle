import { useState } from 'react'
import { Check, CircleStop, Copy, Inbox } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { TransferJob } from './types'

interface Props {
  jobs: TransferJob[]
  onStop: (id: string) => void
}

export default function TransfersPanel({ jobs, onStop }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function copy(job: TransferJob) {
    if (!job.code) return
    await navigator.clipboard.writeText(job.code)
    setCopiedId(job.container_id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <Card className="flex min-h-40 flex-col">
      <CardContent className="flex min-h-0 flex-1 flex-col p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider">Transfers</h3>
          <span
            className={cn(
              'size-2 rounded-full',
              jobs.some((j) => j.status === 'waiting') ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40'
            )}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-center">
              <Inbox className="mb-2 size-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No transfers.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div key={job.container_id} className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="min-w-0 truncate text-sm font-semibold">{job.filename}</p>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={job.status === 'failed' ? 'destructive' : 'outline'}
                        className={cn(
                          'text-[10px] uppercase tracking-wider',
                          job.status === 'waiting' && 'border-primary/40 text-primary'
                        )}
                      >
                        {job.status}
                      </Badge>
                      {job.status === 'waiting' && (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          title="Stop transfer"
                          onClick={() => onStop(job.container_id)}
                        >
                          <CircleStop />
                        </Button>
                      )}
                    </div>
                  </div>
                  {job.code ? (
                    <div className="mt-3 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                        {job.code}
                      </code>
                      <Button variant="outline" size="icon-sm" title="Copy code" onClick={() => copy(job)}>
                        {copiedId === job.container_id ? <Check /> : <Copy />}
                      </Button>
                    </div>
                  ) : (
                    job.status === 'waiting' && (
                      <p className="mt-3 text-xs text-muted-foreground">Waiting for croc code...</p>
                    )
                  )}
                  {job.status === 'done' && (
                    <p className="mt-3 text-xs text-muted-foreground">Transferred.</p>
                  )}
                  {job.status === 'failed' && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Failed with exit code {job.exit_code ?? 'unknown'}.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
