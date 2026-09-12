import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, FileArchive, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import FileBrowser, { type SelectedEntry } from './FileBrowser'
import JobsPanel from './JobsPanel'
import TransfersPanel from './TransfersPanel'
import type { FileListing, TransferJob, ZipJob } from './types'

async function apiError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}))
  return body.error ?? `${res.status} ${res.statusText}`
}

export default function Dashboard() {
  const [listing, setListing] = useState<FileListing | null>(null)
  const [selected, setSelected] = useState<SelectedEntry | null>(null)
  const [jobs, setJobs] = useState<ZipJob[]>([])
  const [transfers, setTransfers] = useState<TransferJob[]>([])
  const [status, setStatus] = useState('Select a file or folder to send it.')
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SelectedEntry | null>(null)
  const [sendTarget, setSendTarget] = useState<SelectedEntry | null>(null)
  const [copies, setCopies] = useState(1)

  const loadFiles = useCallback((path = '') => {
    fetch(`/api/files${path ? `?path=${encodeURIComponent(path)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setListing)
      .catch(() => setStatus('Unable to load files.'))
  }, [])

  const loadJobs = useCallback(() => {
    fetch('/api/compress')
      .then((r) => (r.ok ? r.json() : []))
      .then(setJobs)
      .catch(() => {})
  }, [])

  const loadTransfers = useCallback(() => {
    fetch('/api/transfer')
      .then((r) => (r.ok ? r.json() : []))
      .then(setTransfers)
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadFiles()
    loadJobs()
    // 5s while the tab is focused, 15s when it is not
    const t = setInterval(() => {
      if (document.hidden) return
      loadJobs()
      loadTransfers()
    }, 5000)
    const slow = setInterval(() => {
      if (!document.hidden) return
      loadJobs()
      loadTransfers()
    }, 15000)
    return () => {
      clearInterval(t)
      clearInterval(slow)
    }
  }, [loadFiles, loadJobs, loadTransfers])

  function select(entry: SelectedEntry) {
    setSelected(entry)
    setStatus(entry.kind === 'folder' ? 'Folder selected.' : 'File selected.')
  }

  function navigate(path: string) {
    setSelected(null)
    setStatus('Select a file or folder to send it.')
    loadFiles(path)
  }

  async function remove(entry: SelectedEntry) {
    setStatus(`Deleting ${entry.name}...`)
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(entry.path)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await apiError(res))
      setSelected(null)
      // If we were browsing inside the deleted path, go back to the root
      const here = listing?.path ?? ''
      const inside = here === entry.path || here.startsWith(`${entry.path}/`)
      loadFiles(inside ? '' : here)
      setStatus(`Deleted ${entry.name}.`)
    } catch (err) {
      setStatus((err as Error).message)
    }
  }

  async function zip() {
    if (!selected || selected.kind !== 'folder') return
    setBusy(true)
    setStatus('Starting compression...')
    try {
      const res = await fetch('/api/compress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: selected.path }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      setStatus('Compression started. Monitor status below.')
      loadJobs()
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function stop(id: string) {
    await fetch(`/api/compress/${id}`, { method: 'DELETE' })
    loadJobs()
  }

  async function stopTransfer(id: string) {
    await fetch(`/api/transfer/${id}`, { method: 'DELETE' })
    loadTransfers()
  }

  async function send() {
    if (!sendTarget) return
    setBusy(true)
    setStatus('Starting transfers...')
    try {
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: sendTarget.path, copies }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      setSendTarget(null)
      setCopies(1)
      setStatus('Transfers started. Share the codes with your recipients.')
      loadTransfers()
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="flex flex-col lg:col-span-8">
          <FileBrowser listing={listing} selected={selected} onSelect={select} onNavigate={navigate} />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <Card>
            <CardContent className="p-5">
              <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Selection
              </p>
              <div className="mb-5 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center gap-3">
                  <CheckCircle className="size-8 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold">
                      {selected ? selected.name : 'No folder selected'}
                    </h4>
                    <p className="text-xs text-muted-foreground">{status}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  className="w-full py-3 text-sm font-bold shadow-lg shadow-primary/20"
                  disabled={busy || !selected}
                  onClick={() => selected && setSendTarget(selected)}
                >
                  <Send data-icon="inline-start" />
                  Send
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy || selected?.kind !== 'folder'}
                  onClick={zip}
                >
                  <FileArchive data-icon="inline-start" />
                  Zip Folder
                </Button>
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={!selected}
                  onClick={() => selected && setDeleteTarget(selected)}
                >
                  <Trash2 data-icon="inline-start" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>

          <TransfersPanel jobs={transfers} onStop={stopTransfer} />
          <JobsPanel jobs={jobs} onStop={stop} />
        </div>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === 'folder'
                ? 'The folder and everything inside it will be permanently deleted.'
                : 'This file will be permanently deleted.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = deleteTarget
                setDeleteTarget(null)
                if (target) void remove(target)
              }}
            >
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendTarget !== null} onOpenChange={(open) => !open && setSendTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {sendTarget?.name}</DialogTitle>
            <DialogDescription>
              Starts one croc transfer per copy. Each copy gets its own code — share a code with each
              recipient.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2 text-sm">
            How many copies?
            <input
              type="number"
              min={1}
              max={10}
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value))}
              className="h-10 w-24 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendTarget(null)}>
              Cancel
            </Button>
            <Button disabled={busy || copies < 1} onClick={send}>
              <Send data-icon="inline-start" />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
