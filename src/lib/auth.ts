import { authAPI } from './api'

export interface AuthUser {
  id: string
  email?: string
}

const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED === 'true'

export const auth = {
  isAuthRequired: () => AUTH_REQUIRED,
  getToken: () => localStorage.getItem('access_token'),
  getUser: (): AuthUser | null => {
    const raw = localStorage.getItem('auth_user')
    return raw ? JSON.parse(raw) : null
  },
  isLoggedIn: () => Boolean(localStorage.getItem('access_token')),
  login: async (email: string, password: string) => {
    const data = await authAPI.login(email, password)
    localStorage.setItem('access_token', data.session.access_token)
    localStorage.setItem('auth_user', JSON.stringify(data.user))
    return data
  },
  logout: async () => {
    await authAPI.logout().catch(() => null)
    localStorage.removeItem('access_token')
    localStorage.removeItem('auth_user')
  },
}
