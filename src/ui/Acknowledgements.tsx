import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

const credits = [
  {
    name: '7za container image',
    description: 'crazymax/7zip, the container image used to compress folders.',
    href: 'https://hub.docker.com/r/crazymax/7zip',
  },
  {
    name: 'Logo artwork',
    description: 'Saltwater Crocodile illustration from Thiings.',
    href: 'https://www.thiings.co/things/saltwater-crocodile',
  },
]

export default function Acknowledgements() {
  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Crocle" className="h-12 w-12 rounded-xl object-cover" />
          <div>
            <p className="text-2xl font-bold">Crocle</p>
            <p className="text-xs text-muted-foreground">Acknowledgements</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">Back to app</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="https://github.com/tsecret/crocle" target="_blank" rel="noreferrer">
              GitHub
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Credits &amp; Sources</CardTitle>
          <CardDescription>
            Crocle builds on open-source tools and community assets. Thank you!
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
          {credits.map((credit) => (
            <div key={credit.name} className="rounded-2xl border bg-muted/30 p-4">
              <p className="text-sm font-semibold">{credit.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{credit.description}</p>
              <a
                href={credit.href}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
              >
                {credit.href}
              </a>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  )
}
