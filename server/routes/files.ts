import { Router } from 'express'
import multer from 'multer'
import { parseFile } from '../lib/parser'
import { supabase } from '../lib/supabase'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

router.post('/upload', upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) {
    res.status(400).json({ error: '没有文件' })
    return
  }

  const file = req.file
  const fileName = `${req.userId}/${Date.now()}_${file.originalname}`
  const { error: uploadError } = await supabase.storage
    .from('library-files')
    .upload(fileName, file.buffer, { contentType: file.mimetype })

  if (uploadError) {
    res.status(500).json({ error: '文件上传失败' })
    return
  }

  const { data: signedUrlData } = await supabase.storage
    .from('library-files')
    .createSignedUrl(fileName, 60 * 60)

  const textContent = await parseFile(file.buffer, file.originalname)
  const type = getFileType(file.originalname)
  const { data, error } = await supabase
    .from('library_items')
    .insert({
      user_id: req.userId,
      title: file.originalname.replace(/\.[^.]+$/, ''),
      type,
      file_name: file.originalname,
      file_size: file.size,
      file_url: signedUrlData?.signedUrl ?? '',
      text_content: textContent,
      summary: textContent.slice(0, 150),
      tags: [type.toUpperCase()],
      index_status: 'ready',
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

function getFileType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'txt') return 'txt'
  return 'other'
}

export default router
