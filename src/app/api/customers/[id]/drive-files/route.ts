import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import { NextRequest } from 'next/server'

function extractFolderId(url: string): string | null {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  const key = JSON.parse(raw)
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: customer, error } = await supabase
    .from('customers')
    .select('drive_folder_url')
    .eq('id', id)
    .single()

  if (error || !customer) {
    return Response.json({ error: 'Customer not found' }, { status: 404 })
  }
  if (!customer.drive_folder_url) {
    return Response.json({ files: [] })
  }

  const folderId = extractFolderId(customer.drive_folder_url)
  if (!folderId) {
    return Response.json({ error: 'Invalid Drive folder URL' }, { status: 400 })
  }

  try {
    const auth  = getAuthClient()
    const drive = google.drive({ version: 'v3', auth })

    const res = await drive.files.list({
      q:        `'${folderId}' in parents and trashed = false`,
      fields:   'files(id, name, mimeType, modifiedTime, size, webViewLink)',
      orderBy:  'modifiedTime desc',
      pageSize: 100,
    })

    return Response.json({ files: res.data.files ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Drive API error'
    console.error('drive-files error:', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
