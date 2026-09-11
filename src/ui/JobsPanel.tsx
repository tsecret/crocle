import { CircleStop, Inbox } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { ZipJob } from './types'

interface Props {
  jobs: ZipJob[]
  onStop: (id: string) => void
}

export default function JobsPanel({ jobs, onStop }: Props) {
  return (
    <Card className="flex min-h-40 flex-col">
      <CardContent className="flex min-h-0 flex-1 flex-col p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider">Current jobs</h3>
          <span
            className={cn(
              'size-2 rounded-full',
              jobs.some((j) => j.status === 'compressing') ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40'
            )}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-center">
              <Inbox className="mb-2 size-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No active jobs.</p>
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
                          job.status === 'compressing' && 'border-primary/40 text-primary'
                        )}
                      >
                        {job.status}
                      </Badge>
                      {job.status === 'compressing' && (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          title="Stop job"
                          onClick={() => onStop(job.container_id)}
                        >
                          <CircleStop />
                        </Button>
                      )}
                    </div>
                  </div>
                  {job.status === 'compressing' && (
                    <div className="mt-3">
                      <Progress value={job.progress} className="h-2" />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {job.progress}%{job.current_file ? ` — ${job.current_file}` : ''}
                      </p>
                    </div>
                  )}
                  {job.status === 'done' && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Done — {job.filename} is ready in the files folder.
                    </p>
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
