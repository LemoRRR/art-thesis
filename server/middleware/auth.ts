import type { NextFunction, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'

export interface AuthRequest extends Request {
  userId?: string
  accessToken?: string
}

const LOCAL_DEMO_USER_ID = 'local-demo-user'
const LOCAL_TOKEN_PREFIX = 'dev-local-demo-token-'
const AUTH_TIMEOUT_MS = Number(process.env.AUTH_TIMEOUT_MS ?? 15000)

function canUseLocalDemoAuth() {
  return process.env.NODE_ENV !== 'production'
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), AUTH_TIMEOUT_MS)
    }),
  ])
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

  try {
    const { data: { user }, error } = await withTimeout(supabase.auth.getUser(token), 'Supabase auth')
    if (error || !user) {
      res.status(401).json({ error: 'Token 无效或已过期' })
      return
    }

    req.userId = user.id
    req.accessToken = token
    next()
  } catch (error) {
    res.status(504).json({
      error: error instanceof Error ? error.message : '登录校验服务响应较慢，请刷新后重试',
    })
    return
  }
}
