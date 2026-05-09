'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: '#1F3864' }}
          >
            <span className="text-white text-2xl font-bold">RP</span>
          </div>
          <h1 className="text-white text-2xl font-semibold">
            Right Path Agency System
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Makal Financial Services
          </p>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-lg">Sign in</CardTitle>
            <CardDescription className="text-slate-400">
              Team members sign in with your email and password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@makalfinancial.com"
                  required
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
              {error && (
                <div className="bg-red-950 border border-red-800 text-red-300 text-sm p-3 rounded-md">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                disabled={loading}
                className="w-full text-white font-medium"
                style={{ backgroundColor: '#1F3864' }}
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-slate-600 text-xs mt-6">
          Right Path Agency System · Confidential
        </p>
      </div>
    </div>
  )
}