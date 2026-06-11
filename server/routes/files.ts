import { Router } from 'express'
import multer from 'multer'
import { extractDimensions } from '../lib/extract.js'
import { parseFile } from '../lib/parser.js'
import { createUserClient, supabase } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

function buildStorageKey(userId: string, originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, '') || 'bin'
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${userId}/${id}.${ext}`
}

function decodeUploadFileName(fileName: string): string {
  try {
    const decoded = Buffer.from(fileName, 'latin1').toString('utf8')
    return decoded.includes('�') ? fileName : decoded
  } catch {
    return fileName
  }
}

function getFileType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'txt') return 'txt'
  return 'other'
}

async function createLibraryItemFromBuffer({
  accessToken,
  userId,
  originalFileName,
  storagePath,
  buffer,
  fileSize,
}: {
  accessToken: string
  userId: string
  originalFileName: string
  storagePath: string
  buffer: Buffer
  fileSize: number
}) {
  const db = createUserClient(accessToken)
  const { data: signedUrlData } = await supabase.storage
    .from('library-files')
    .createSignedUrl(storagePath, 60 * 60)

  const textContent = await parseFile(buffer, originalFileName)
  const type = getFileType(originalFileName)
  const { data, error } = await db
    .from('library_items')
    .insert({
      user_id: userId,
      title: originalFileName.replace(/\.[^.]+$/, ''),
      type,
      file_name: originalFileName,
      file_size: fileSize,
      file_url: signedUrlData?.signedUrl ?? '',
      text_content: textContent,
      summary: textContent.slice(0, 150),
      tags: [type.toUpperCase()],
      index_status: 'ready',
      extract_status: 'processing',
    })
    .select()
    .single()

  if (error) throw error

  extractDimensions(data.id, textContent, accessToken).catch(() => {
    // Errors are recorded by extractDimensions and reflected on the item.
  })

  return data
}

router.post('/signed-upload', async (req: AuthRequest, res) => {
  const { fileName, contentType, fileSize } = req.body as {
    fileName?: string
    contentType?: string
    fileSize?: number
  }

  if (!fileName) {
    res.status(400).json({ error: 'Missing file name' })
    return
  }

  const originalFileName = decodeUploadFileName(fileName)
  const storagePath = buildStorageKey(req.userId!, originalFileName)
  const { data, error } = await supabase.storage
    .from('library-files')
    .createSignedUploadUrl(storagePath, { upsert: false })

  if (error || !data) {
    console.error('[Files] signed upload url failed', error)
    res.status(500).json({ error: `File upload preparation failed: ${error?.message ?? 'unknown error'}` })
    return
  }

  res.json({
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    fileName: originalFileName,
    contentType: contentType || 'application/octet-stream',
    fileSize: Number(fileSize) || 0,
  })
})

router.post('/import-uploaded', async (req: AuthRequest, res) => {
  const { path, fileName, fileSize } = req.body as {
    path?: string
    fileName?: string
    fileSize?: number
  }

  if (!path || !fileName) {
    res.status(400).json({ error: 'Missing uploaded file metadata' })
    return
  }

  if (!path.startsWith(`${req.userId}/`)) {
    res.status(403).json({ error: 'Uploaded file path does not belong to this user' })
    return
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('library-files')
    .download(path)

  if (downloadError || !fileData) {
    console.error('[Files] storage download failed', downloadError)
    res.status(500).json({ error: `File import failed: ${downloadError?.message ?? 'download failed'}` })
    return
  }

  try {
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const data = await createLibraryItemFromBuffer({
      accessToken: req.accessToken!,
      userId: req.userId!,
      originalFileName: decodeUploadFileName(fileName),
      storagePath: path,
      buffer,
      fileSize: Number(fileSize) || buffer.byteLength,
    })
    res.json(data)
  } catch (error) {
    console.error('[Files] uploaded file import failed', error)
    res.status(500).json({ error: error instanceof Error ? error.message : 'File import failed' })
  }
})

router.post('/upload', upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }

  const file = req.file
  const originalFileName = decodeUploadFileName(file.originalname)
  const storagePath = buildStorageKey(req.userId!, originalFileName)
  const { error: uploadError } = await supabase.storage
    .from('library-files')
    .upload(storagePath, file.buffer, { contentType: file.mimetype })

  if (uploadError) {
    console.error('[Files] Supabase Storage upload failed', uploadError)
    res.status(500).json({ error: `File upload failed: ${uploadError.message}` })
    return
  }

  try {
    const data = await createLibraryItemFromBuffer({
      accessToken: req.accessToken!,
      userId: req.userId!,
      originalFileName,
      storagePath,
      buffer: file.buffer,
      fileSize: file.size,
    })
    res.json(data)
  } catch (error) {
    console.error('[Files] library item insert failed', error)
    res.status(500).json({ error: error instanceof Error ? error.message : 'File upload failed' })
  }
})

export default router
