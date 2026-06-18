import { authAPI } from './api'

export interface AuthUser {
  id: string
  email?: string
  user_metadata?: {
    displayName?: string
    display_name?: string
    name?: string
  }
}

const AUTH_REQUIRED = import.meta.env.PROD || import.meta.env.VITE_AUTH_REQUIRED === 'true'

export const auth = {
  isAuthRequired: () => AUTH_REQUIRED,
  getToken: () => localStorage.getItem('access_token'),
  getUser: (): AuthUser | null => {
    const raw = localStorage.getItem('auth_user')
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  },
  isLoggedIn: () => Boolean(localStorage.getItem('access_token') && auth.getUser()),
  clearSession: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('auth_user')
  },
  login: async (email: string, password: string) => {
    const data = await authAPI.login(email, password)
    localStorage.setItem('access_token', data.session.access_token)
    localStorage.setItem('auth_user', JSON.stringify(data.user))
    return data
  },
  logout: async () => {
    await authAPI.logout().catch(() => null)
    auth.clearSession()
  },
}
