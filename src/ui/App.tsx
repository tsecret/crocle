import { Link, Route, Routes } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Acknowledgements from './Acknowledgements'
import Dashboard from './Dashboard'

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="Crocle" className="h-10 w-10 rounded-md object-cover" />
          <h1 className="text-xl font-bold tracking-tight">Crocle</h1>
        </Link>
        <nav className="flex items-center gap-4 sm:gap-6">
          <Link
            to="/acknowledgements"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Acknowledgements
          </Link>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://github.com/tsecret/crocle"
              target="_blank"
              rel="noreferrer"
              className="rounded-full"
            >
              GitHub
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </nav>
      </div>
    </header>
  )
}

export default function App() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <Header />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/acknowledgements" element={<Acknowledgements />} />
      </Routes>
    </div>
  )
}
