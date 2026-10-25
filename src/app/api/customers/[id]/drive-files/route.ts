import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'

function extractFolderId(url: string): string | null {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    // drive.file: create/modify only files this app created or opened
    // drive.readonly: list and read any file the service account can see
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
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
      fields:   'files(id, name, mimeType, modifiedTime, size)',
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: customer, error } = await supabase
    .from('customers')
    .select('drive_folder_url')
    .eq('id', id)
    .single()

  if (error || !customer?.drive_folder_url) {
    return Response.json({ error: 'Customer not found or no Drive folder set' }, { status: 404 })
  }

  const folderId = extractFolderId(customer.drive_folder_url)
  if (!folderId) {
    return Response.json({ error: 'Invalid Drive folder URL' }, { status: 400 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  // 25 MB limit
  if (file.size > 25 * 1024 * 1024) {
    return Response.json({ error: 'File exceeds 25 MB limit' }, { status: 413 })
  }

  try {
    const auth  = getAuthClient()
    const drive = google.drive({ version: 'v3', auth })

    const buffer    = Buffer.from(await file.arrayBuffer())
    const readable  = Readable.from(buffer)

    const uploaded = await drive.files.create({
      requestBody: {
        name:    file.name,
        parents: [folderId],
      },
      media: {
        mimeType: file.type || 'application/octet-stream',
        body:     readable,
      },
      fields: 'id, name, mimeType, modifiedTime, size',
    })

    return Response.json({ file: uploaded.data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Drive API error'
    console.error('drive-files upload error:', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
