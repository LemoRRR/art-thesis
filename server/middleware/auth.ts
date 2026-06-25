import type { NextFunction, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'

export interface AuthRequest extends Request {
  userId?: string
  accessToken?: string
}

const LOCAL_DEMO_USER_ID = 'local-demo-user'
const LOCAL_TOKEN_PREFIX = 'dev-local-demo-token-'

function canUseLocalDemoAuth() {
  return process.env.NODE_ENV !== 'production'
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    if (canUseLocalDemoAuth()) {
      req.userId = LOCAL_DEMO_USER_ID
      req.accessToken = `${LOCAL_TOKEN_PREFIX}anonymous`
      next()
      return
    }
    res.status(401).json({ error: '未登录' })
    return
  }

  const token = authHeader.slice(7)
  if (canUseLocalDemoAuth() && token.startsWith(LOCAL_TOKEN_PREFIX)) {
    req.userId = LOCAL_DEMO_USER_ID
    req.accessToken = token
    next()
    return
  }

  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    res.status(401).json({ error: 'Token 无效或已过期' })
    return
  }

  req.userId = user.id
  req.accessToken = token
  next()
}
