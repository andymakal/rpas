import { createAdminClient } from '@/lib/supabase/admin'
import { google } from 'googleapis'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'

const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.'

const EXPORT_MIME: Record<string, string> = {
  'application/vnd.google-apps.document':     'application/pdf',
  'application/vnd.google-apps.spreadsheet':  'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing':      'application/pdf',
}

function extractFolderId(url: string): string | null {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-\s]/g, '_')
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await params
  const supabase = createAdminClient()

  // Verify customer exists and has a drive folder
  const { data: customer, error } = await supabase
    .from('customers')
    .select('drive_folder_url')
    .eq('id', id)
    .single()

  if (error || !customer?.drive_folder_url) {
    return new Response('Not found', { status: 404 })
  }

  const folderId = extractFolderId(customer.drive_folder_url)
  if (!folderId) {
    return new Response('Invalid Drive folder URL', { status: 400 })
  }

  try {
    const auth  = getAuthClient()
    const drive = google.drive({ version: 'v3', auth })

    // Fetch file metadata and verify it belongs to this customer's folder
    const metaRes = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, parents',
    })
    const meta = metaRes.data

    if (!meta.parents?.includes(folderId)) {
      return new Response('Forbidden', { status: 403 })
    }

    const origName = meta.name ?? fileId
    const mimeType = meta.mimeType ?? 'application/octet-stream'

    // Google Workspace files must be exported; everything else streamed directly
    const isWorkspace = mimeType.startsWith(GOOGLE_APPS_PREFIX)
    const exportMime  = isWorkspace ? (EXPORT_MIME[mimeType] ?? 'application/pdf') : null

    if (isWorkspace && exportMime) {
      const exportRes = await drive.files.export(
        { fileId, mimeType: exportMime },
        { responseType: 'stream' }
      )
      const filename = safeFilename(`${origName}.pdf`)
      const webStream = Readable.toWeb(exportRes.data as Readable) as ReadableStream
      return new Response(webStream, {
        headers: {
          'Content-Type':        exportMime,
          'Content-Disposition': `inline; filename="${filename}"`,
          'Cache-Control':       'private, max-age=300',
        },
      })
    }

    const fileRes = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    )
    const filename    = safeFilename(origName)
    const webStream   = Readable.toWeb(fileRes.data as Readable) as ReadableStream
    const contentType = mimeType === 'application/octet-stream'
      ? 'application/octet-stream'
      : mimeType

    return new Response(webStream, {
      headers: {
        'Content-Type':        contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control':       'private, max-age=300',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Drive API error'
    console.error('drive-file proxy error:', msg)
    return new Response(msg, { status: 500 })
  }
}
